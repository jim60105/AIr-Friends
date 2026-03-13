// src/utils/gelf-transport.ts

import type { LogEntry } from "../types/logger.ts";
import type { GelfConfig } from "../types/config.ts";

/**
 * GELF message structure (GELF Payload Specification version 1.1)
 * @see https://go2docs.graylog.org/current/getting_in_log_data/gelf.html
 */
interface GelfMessage {
  version: "1.1";
  host: string;
  short_message: string;
  full_message?: string;
  timestamp: number;
  level: number;
  [key: `_${string}`]: string | number | undefined;
}

/**
 * Map internal LogLevel names to Syslog severity levels used by GELF.
 *
 * Syslog levels (RFC 5424):
 *   0 = Emergency, 1 = Alert, 2 = Critical, 3 = Error,
 *   4 = Warning, 5 = Notice, 6 = Informational, 7 = Debug
 */
const LOG_LEVEL_TO_SYSLOG: Record<string, number> = {
  FATAL: 2,
  ERROR: 3,
  WARN: 4,
  INFO: 6,
  DEBUG: 7,
};

/**
 * GelfTransport sends log entries to a GELF endpoint asynchronously.
 * Supports both HTTP POST and raw TCP protocols.
 * Errors during sending are silently caught and logged to stderr
 * to avoid disrupting the main application flow.
 */
export class GelfTransport {
  private static readonly VALID_FIELD_NAME = /^[\w.\-]*$/;
  private readonly endpoint: string;
  private readonly hostname: string;
  private readonly protocol: "http" | "tcp" | "udp";
  private tcpConnection: Deno.TcpConn | null = null;
  private connecting: boolean = false;
  private udpConn: Deno.DatagramConn | null = null;
  private readonly compress: boolean;
  private readonly maxChunkSize: number;

  constructor(config: GelfConfig) {
    this.endpoint = config.endpoint;
    this.hostname = config.hostname ?? "air-friends";
    this.protocol = config.protocol ?? "http";
    this.compress = config.compress ?? (this.protocol === "udp");
    this.maxChunkSize = 8192;
  }

  /**
   * Convert a LogEntry to a GELF message and send it to the endpoint.
   * This method is fire-and-forget; errors are caught internally.
   */
  send(entry: LogEntry): void {
    const message = this.toGelfMessage(entry);

    if (this.protocol === "tcp") {
      this.sendTcp(message);
    } else if (this.protocol === "udp") {
      this.sendUdp(message);
    } else {
      this.sendHttp(message);
    }
  }

  /**
   * Close the transport, releasing any held resources.
   * For TCP protocol, closes the persistent connection.
   */
  close(): void {
    if (this.tcpConnection) {
      try {
        this.tcpConnection.close();
      } catch {
        // Ignore close errors
      }
      this.tcpConnection = null;
    }

    if (this.udpConn) {
      try {
        this.udpConn.close();
      } catch {
        // Ignore close errors
      }
      this.udpConn = null;
    }
  }

  /**
   * Send GELF message via HTTP POST.
   */
  private sendHttp(message: GelfMessage): void {
    fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    }).then((res) => {
      // Consume the response body to prevent resource leaks
      res.body?.cancel();
    }).catch((err) => {
      console.error(
        `[GelfTransport] Failed to send log to ${this.endpoint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /**
   * Send GELF message via raw TCP (JSON + null byte terminator).
   * Maintains a persistent connection with lazy reconnect on failure.
   */
  private sendTcp(message: GelfMessage): void {
    const payload = new TextEncoder().encode(JSON.stringify(message) + "\0");

    const doSend = async () => {
      const conn = await this.getTcpConnection();
      await conn.write(payload);
    };

    doSend().catch((_err) => {
      // Connection might be stale; close and retry once
      this.closeTcpConnection();
      const doRetry = async () => {
        const conn = await this.getTcpConnection();
        await conn.write(payload);
      };
      doRetry().catch((retryErr) => {
        this.closeTcpConnection();
        console.error(
          `[GelfTransport] Failed to send log to ${this.endpoint}: ${
            retryErr instanceof Error ? retryErr.message : String(retryErr)
          }`,
        );
      });
    });
  }

  /**
   * Send GELF message via UDP with optional GZIP compression and chunking.
   * Messages larger than maxChunkSize are chunked per the GELF spec.
   * GZIP compression is enabled by default for UDP (per spec: "GZIP is the protocol default").
   */
  private sendUdp(message: GelfMessage): void {
    const doSend = async () => {
      const jsonBytes = new TextEncoder().encode(JSON.stringify(message));
      const payload = this.compress ? await this.gzipCompress(jsonBytes) : jsonBytes;
      const { hostname, port } = this.parseUdpEndpoint();
      const conn = this.getUdpConnection();

      if (payload.length <= this.maxChunkSize) {
        await conn.send(payload, { transport: "udp", hostname, port });
      } else {
        const chunks = this.chunkPayload(payload);
        for (const chunk of chunks) {
          await conn.send(chunk, { transport: "udp", hostname, port });
        }
      }
    };

    doSend().catch((err) => {
      console.error(
        `[GelfTransport] Failed to send log to ${this.endpoint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /**
   * Get or create a UDP connection for sending datagrams.
   * Binds to an ephemeral local port.
   */
  private getUdpConnection(): Deno.DatagramConn {
    if (!this.udpConn) {
      this.udpConn = Deno.listenDatagram({
        transport: "udp",
        hostname: "0.0.0.0",
        port: 0,
      });
    }
    return this.udpConn;
  }

  /**
   * Parse UDP endpoint from the configured endpoint string.
   * Supports formats: "host:port", "udp://host:port", "http://host:port"
   */
  private parseUdpEndpoint(): { hostname: string; port: number } {
    let hostStr = this.endpoint;

    if (hostStr.startsWith("udp://")) {
      hostStr = hostStr.slice(6);
    } else if (hostStr.startsWith("http://") || hostStr.startsWith("https://")) {
      try {
        const url = new URL(this.endpoint);
        return {
          hostname: url.hostname,
          port: parseInt(url.port) || 12201,
        };
      } catch {
        // Fall through to manual parsing
      }
    }

    const pathIndex = hostStr.indexOf("/");
    if (pathIndex !== -1) {
      hostStr = hostStr.slice(0, pathIndex);
    }

    const parts = hostStr.split(":");
    const hostname = parts[0];
    const port = parts.length > 1 ? parseInt(parts[1]) : 12201;

    return { hostname, port };
  }

  /**
   * Split a payload into GELF chunks per the chunking specification.
   * Each chunk has: magic bytes (0x1e 0x0f) + message ID (8) + seq num (1) + seq count (1) + data
   */
  private chunkPayload(payload: Uint8Array): Uint8Array[] {
    const headerSize = 12;
    const maxDataSize = this.maxChunkSize - headerSize;
    const chunkCount = Math.ceil(payload.length / maxDataSize);

    if (chunkCount > 128) {
      throw new Error(
        `GELF message too large: requires ${chunkCount} chunks (max 128)`,
      );
    }

    const messageId = this.generateMessageId();
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const offset = i * maxDataSize;
      const data = payload.subarray(offset, offset + maxDataSize);

      const chunk = new Uint8Array(headerSize + data.length);
      // Magic bytes
      chunk[0] = 0x1e;
      chunk[1] = 0x0f;
      // Message ID (8 bytes)
      chunk.set(messageId, 2);
      // Sequence number and count
      chunk[10] = i;
      chunk[11] = chunkCount;
      // Payload data
      chunk.set(data, headerSize);

      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Generate an 8-byte message ID for chunk identification.
   * Uses 4 bytes from timestamp (ms) + 4 random bytes.
   */
  private generateMessageId(): Uint8Array {
    const id = new Uint8Array(8);
    const timestamp = Date.now();
    // Lower 32 bits of timestamp
    id[0] = (timestamp >> 24) & 0xff;
    id[1] = (timestamp >> 16) & 0xff;
    id[2] = (timestamp >> 8) & 0xff;
    id[3] = timestamp & 0xff;
    // 4 random bytes
    crypto.getRandomValues(id.subarray(4));
    return id;
  }

  /**
   * GZIP compress data using the Web Compression API.
   */
  private async gzipCompress(data: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(new Uint8Array(data));
    writer.close();

    const reader = cs.readable.getReader();
    const parts: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    let totalLength = 0;
    for (const p of parts) totalLength += p.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  }

  /**
   * Get or create a TCP connection to the GELF endpoint.
   * Parses host and port from the endpoint URL.
   */
  private async getTcpConnection(): Promise<Deno.TcpConn> {
    if (this.tcpConnection) {
      return this.tcpConnection;
    }

    // Prevent concurrent connection attempts
    if (this.connecting) {
      // Wait briefly for the other connection attempt to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.tcpConnection) return this.tcpConnection;
    }

    this.connecting = true;
    try {
      const { hostname, port } = this.parseTcpEndpoint();
      this.tcpConnection = await Deno.connect({ hostname, port });
      return this.tcpConnection;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Parse TCP endpoint from the configured endpoint string.
   * Supports formats: "host:port", "tcp://host:port", "http://host:port"
   */
  private parseTcpEndpoint(): { hostname: string; port: number } {
    let hostStr = this.endpoint;

    // Strip protocol prefix if present
    if (hostStr.startsWith("tcp://")) {
      hostStr = hostStr.slice(6);
    } else if (hostStr.startsWith("http://") || hostStr.startsWith("https://")) {
      try {
        const url = new URL(this.endpoint);
        return {
          hostname: url.hostname,
          port: parseInt(url.port) || 12201,
        };
      } catch {
        // Fall through to manual parsing
      }
    }

    // Remove trailing path
    const pathIndex = hostStr.indexOf("/");
    if (pathIndex !== -1) {
      hostStr = hostStr.slice(0, pathIndex);
    }

    const parts = hostStr.split(":");
    const hostname = parts[0];
    const port = parts.length > 1 ? parseInt(parts[1]) : 12201;

    return { hostname, port };
  }

  /**
   * Close the TCP connection without error propagation.
   */
  private closeTcpConnection(): void {
    if (this.tcpConnection) {
      try {
        this.tcpConnection.close();
      } catch {
        // Ignore close errors
      }
      this.tcpConnection = null;
    }
  }

  /**
   * Convert a LogEntry to GELF message format.
   */
  private toGelfMessage(entry: LogEntry): GelfMessage {
    const gelf: GelfMessage = {
      version: "1.1",
      host: this.hostname,
      short_message: entry.message,
      timestamp: new Date(entry.timestamp).getTime() / 1000,
      level: LOG_LEVEL_TO_SYSLOG[entry.level] ?? 6,
      _module: entry.module,
      _log_level: entry.level,
    };

    if (entry.messageTemplate) {
      gelf._messageTemplate = entry.messageTemplate;
    }

    if (entry.context) {
      for (const [key, value] of Object.entries(entry.context)) {
        if (value === undefined || value === null) continue;
        if (key === "id") continue;
        if (!GelfTransport.VALID_FIELD_NAME.test(key)) continue;
        const gelfKey = `_${key}` as `_${string}`;
        gelf[gelfKey] = typeof value === "boolean"
          ? String(value)
          : typeof value === "object"
          ? JSON.stringify(value)
          : (value as string | number);
      }
    }

    return gelf;
  }
}
