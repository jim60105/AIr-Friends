// src/platforms/misskey/misskey-client.ts

import { api as MisskeyApi, Stream } from "misskey-js";
import { MisskeyAdapterConfig } from "./misskey-config.ts";
import { createLogger } from "@utils/logger.ts";
import { ErrorCode, PlatformError } from "../../types/errors.ts";

const logger = createLogger("MisskeyClient");

/**
 * Misskey client wrapper
 */
export class MisskeyClient {
  private readonly api: MisskeyApi.APIClient;
  private stream: Stream | null = null;
  private readonly config: MisskeyAdapterConfig;

  constructor(config: MisskeyAdapterConfig) {
    this.config = config;
    this.api = new MisskeyApi.APIClient({
      origin: `${config.secure ? "https" : "http"}://${config.host}`,
      credential: config.token,
    });
  }

  /**
   * Get the API client
   */
  getApi(): MisskeyApi.APIClient {
    return this.api;
  }

  /**
   * Create and connect to streaming API
   */
  connectStream(): Stream {
    if (this.stream) {
      return this.stream;
    }

    logger.info("Connecting to Misskey streaming API", {
      host: this.config.host,
    });

    this.stream = new Stream(
      `${this.config.secure ? "https" : "http"}://${this.config.host}`,
      { token: this.config.token },
    );

    return this.stream;
  }

  /**
   * Disconnect from streaming API
   */
  disconnectStream(): void {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
      logger.info("Disconnected from Misskey streaming API");
    }
  }

  /**
   * Get the current stream (if connected)
   */
  getStream(): Stream | null {
    return this.stream;
  }

  /**
   * Make an API request
   */
  async request<T = unknown>(
    endpoint: string,
    // deno-lint-ignore no-explicit-any
    params: Record<string, any> = {},
  ): Promise<T> {
    try {
      // deno-lint-ignore no-explicit-any
      return await this.api.request(endpoint as any, params as any);
    } catch (error) {
      // Detect non-JSON responses (e.g., "Bad Gateway", "Service Unavailable")
      // which indicate the server is unreachable rather than an API-level error
      if (error instanceof SyntaxError && error.message.includes("is not valid JSON")) {
        logger.error("Misskey server unreachable (non-JSON response)", {
          endpoint,
          error: error.message,
        });
        throw new PlatformError(
          ErrorCode.PLATFORM_CONNECTION_FAILED,
          `Misskey server returned non-JSON response: ${error.message}`,
          { endpoint },
        );
      }

      const errorMessage = error instanceof Error
        ? error.message
        : (typeof error === "object" && error !== null)
        ? JSON.stringify(error)
        : String(error);
      logger.error("Misskey API error", {
        endpoint,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get current user info (i.e., the bot's account info)
   */
  getSelf(): Promise<{
    id: string;
    username: string;
    name: string | null;
  }> {
    return this.request("i");
  }

  /**
   * Upload a file to Misskey Drive via multipart/form-data.
   * The standard APIClient.request() only supports JSON bodies,
   * but drive/files/create requires multipart/form-data.
   */
  async uploadFile(
    fileContent: Uint8Array,
    fileName: string,
  ): Promise<{ id: string; url: string }> {
    const formData = new FormData();
    formData.append("i", this.config.token);
    formData.append("name", fileName);
    formData.append(
      "file",
      new Blob([new Uint8Array(fileContent)]),
      fileName,
    );

    const origin = `${this.config.secure ? "https" : "http"}://${this.config.host}`;
    const response = await fetch(`${origin}/api/drive/files/create`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();

      // HTTP 502/503/504 indicate gateway-level issues
      if (response.status >= 502 && response.status <= 504) {
        throw new PlatformError(
          ErrorCode.PLATFORM_CONNECTION_FAILED,
          `Misskey server unavailable (${response.status}): ${errorBody}`,
          { endpoint: "drive/files/create", status: response.status },
        );
      }

      throw new PlatformError(
        ErrorCode.PLATFORM_API_ERROR,
        `Drive upload failed (${response.status}): ${errorBody}`,
        { endpoint: "drive/files/create", status: response.status },
      );
    }

    const result = await response.json();
    logger.info("File uploaded to Misskey Drive", {
      fileId: result.id,
      fileName,
    });

    return { id: result.id, url: result.url };
  }
}
