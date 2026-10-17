// tests/helpers/email-imap-service.ts
//
// In-process deterministic IMAP test fixture for EmailImapClient tests.
// Supports direct TLS (port 993 style) and plain TCP with STARTTLS (port 143 style).
// Provides an isolated, deterministic IMAP server implementing the subset of commands
// used by EmailImapClient: CAPABILITY, STARTTLS, LOGIN, SELECT, STATUS, UID SEARCH,
// UID FETCH, APPEND, LOGOUT.

import * as net from "node:net";
import * as tls from "node:tls";
import { spawnSync } from "node:child_process";

export interface ImapFixtureMessage {
  uid: number;
  flags?: string[];
  headers?: Record<string, string>;
  rawMime: Uint8Array | string;
  advertisedSize?: number; // Allows testing size mismatch / server lying
}

export interface ImapFixtureOptions {
  host?: string;
  port?: number;
  tlsMode: "tls" | "starttls" | "plaintext-no-starttls";
  username?: string;
  password?: string;
  uidValidity?: number;
  uidNext?: number;
  initialMessages?: ImapFixtureMessage[];
  omitStartTlsCapability?: boolean;
  rejectStartTlsCommand?: boolean;
  corruptCert?: boolean;
}

export interface GeneratedTlsCert {
  cert: string;
  key: string;
}

let cachedCert: GeneratedTlsCert | null = null;

export function getOrCreateFixtureCert(): GeneratedTlsCert {
  if (cachedCert) return cachedCert;

  const res = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1,DNS:localhost",
    "-days",
    "7",
    "-keyout",
    "/dev/stdout",
  ], { encoding: "utf8" });

  if (res.error || res.status !== 0) {
    throw new Error(
      `Failed to generate self-signed test cert: ${res.error?.message || res.stderr}`,
    );
  }

  const output = res.stdout;
  const keyMatch = output.match(
    /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/,
  );
  const certMatch = output.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
  );

  if (!keyMatch || !certMatch) {
    throw new Error("Could not parse key and certificate from openssl output");
  }

  cachedCert = {
    key: keyMatch[0],
    cert: certMatch[0],
  };
  return cachedCert;
}

export class EmailImapTestService {
  private server: net.Server | tls.Server | null = null;
  public port = 0;
  public host: string;
  public caCert: string;

  public authAttempts: Array<{ user: string; pass: string; secure: boolean }> = [];
  public executedCommands: string[] = [];
  public appendedMessages: Array<{ folder: string; content: Uint8Array }> = [];

  private messages: Map<number, ImapFixtureMessage> = new Map();
  private uidValidity: number;
  private uidNext: number;
  private options: ImapFixtureOptions;

  constructor(options: ImapFixtureOptions) {
    this.options = options;
    this.host = options.host || "127.0.0.1";
    this.uidValidity = options.uidValidity ?? 12345;
    this.uidNext = options.uidNext ?? 100;

    const certData = getOrCreateFixtureCert();
    this.caCert = options.corruptCert ? certData.cert.replace("MII", "XXX") : certData.cert;

    if (options.initialMessages) {
      for (const msg of options.initialMessages) {
        this.messages.set(msg.uid, msg);
        if (msg.uid >= this.uidNext) {
          this.uidNext = msg.uid + 1;
        }
      }
    }
  }

  addMessage(msg: ImapFixtureMessage): void {
    this.messages.set(msg.uid, msg);
    if (msg.uid >= this.uidNext) {
      this.uidNext = msg.uid + 1;
    }
  }

  async start(): Promise<number> {
    const certData = getOrCreateFixtureCert();

    if (this.options.tlsMode === "tls") {
      // Direct TLS server
      this.server = tls.createServer({
        cert: certData.cert,
        key: certData.key,
      }, (socket) => {
        this.handleConnection(socket, true);
      });
    } else {
      // Plain TCP server (which may upgrade via STARTTLS)
      this.server = net.createServer((socket) => {
        this.handleConnection(socket, false);
      });
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.options.port ?? 0, this.host, () => {
        const addr = this.server?.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          resolve();
        } else {
          reject(new Error("Unable to obtain bound port"));
        }
      });
      this.server?.on("error", reject);
    });

    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }

  private handleConnection(
    rawSocket: net.Socket | tls.TLSSocket,
    initiallySecure: boolean,
  ): void {
    let currentSocket: net.Socket | tls.TLSSocket = rawSocket;
    let isSecure = initiallySecure;
    let _selectedFolder: string | null = null;
    let buffer = Buffer.alloc(0);

    // Literal reading state
    let expectingLiteralBytes: number | null = null;
    let pendingCommandPrefix = "";
    let accumulatedLiteral = Buffer.alloc(0);
    let expectingAuthPlain = false;
    let pendingAuthTag = "";

    const handlePlainAuth = (tag: string, base64Payload: string) => {
      expectingAuthPlain = false;
      pendingAuthTag = "";
      const decoded = Buffer.from(base64Payload, "base64");
      // SASL PLAIN format: [authzid] \0 authcid \0 passwd
      const parts = decoded.toString("binary").split("\0");
      let user = "";
      let pass = "";
      if (parts.length >= 3) {
        user = parts[1];
        pass = parts[2];
      }
      this.authAttempts.push({ user, pass, secure: isSecure });

      const expectedUser = this.options.username ?? "test@example.com";
      const expectedPass = this.options.password ?? "secret123";

      if (user === expectedUser && pass === expectedPass) {
        send(`${tag} OK [CAPABILITY ${getCapabilityString(isSecure)}] Logged in`);
      } else {
        send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
      }
    };

    const send = (line: string) => {
      if (currentSocket.writable) {
        currentSocket.write(line + "\r\n");
      }
    };

    const getCapabilityString = (secure: boolean): string => {
      const caps = ["IMAP4rev1"];
      if (
        !secure && this.options.tlsMode === "starttls" &&
        !this.options.omitStartTlsCapability
      ) {
        caps.push("STARTTLS");
      }
      caps.push("AUTH=PLAIN", "UNSELECT", "UIDPLUS");
      return caps.join(" ");
    };

    // Greeting
    send(`* OK [CAPABILITY ${getCapabilityString(isSecure)}] IMAP4rev1 Service Ready`);

    const processCommandLine = (fullLine: string) => {
      this.executedCommands.push(fullLine);
      const spaceIdx = fullLine.indexOf(" ");
      if (spaceIdx === -1) return;
      const tag = fullLine.slice(0, spaceIdx);
      const rest = fullLine.slice(spaceIdx + 1).trim();

      const cmdSpaceIdx = rest.indexOf(" ");
      const cmd = (cmdSpaceIdx === -1 ? rest : rest.slice(0, cmdSpaceIdx))
        .toUpperCase();
      const args = cmdSpaceIdx === -1 ? "" : rest.slice(cmdSpaceIdx + 1).trim();

      switch (cmd) {
        case "CAPABILITY": {
          send(`* CAPABILITY ${getCapabilityString(isSecure)}`);
          send(`${tag} OK CAPABILITY completed`);
          break;
        }

        case "STARTTLS": {
          if (isSecure || this.options.rejectStartTlsCommand) {
            send(`${tag} BAD STARTTLS not available`);
            break;
          }

          send(`${tag} OK Begin TLS negotiation now`);

          // Upgrade plain TCP socket to server TLS socket
          const certData = getOrCreateFixtureCert();
          const secureContext = tls.createSecureContext({
            cert: certData.cert,
            key: certData.key,
          });

          // Detach listeners from plain socket
          rawSocket.removeAllListeners("data");
          rawSocket.removeAllListeners("error");

          const tlsSocket = new tls.TLSSocket(rawSocket, {
            isServer: true,
            secureContext,
          });

          currentSocket = tlsSocket;
          isSecure = true;
          buffer = Buffer.alloc(0);
          expectingLiteralBytes = null;
          pendingCommandPrefix = "";
          accumulatedLiteral = Buffer.alloc(0);

          tlsSocket.on("data", onData);
          tlsSocket.on("error", () => {
            // ignore socket errors on tear down
          });
          break;
        }

        case "AUTHENTICATE": {
          // AUTHENTICATE PLAIN [initial-response]
          const authSub = args.split(/\s+/)[0]?.toUpperCase();
          const initialResp = args.split(/\s+/)[1];
          if (authSub === "PLAIN") {
            if (initialResp) {
              handlePlainAuth(tag, initialResp);
            } else {
              expectingAuthPlain = true;
              pendingAuthTag = tag;
              send("+");
            }
          } else {
            send(`${tag} NO [AUTHENTICATIONFAILED] Unsupported SASL mechanism`);
          }
          break;
        }

        case "NAMESPACE": {
          send(`* NAMESPACE (("" "/")) NIL NIL`);
          send(`${tag} OK NAMESPACE completed`);
          break;
        }

        case "ID": {
          send(`* ID ("name" "air-friends-fixture" "version" "1.0.0")`);
          send(`${tag} OK ID completed`);
          break;
        }

        case "ENABLE": {
          send(`* ENABLED`);
          send(`${tag} OK ENABLE completed`);
          break;
        }

        case "LIST": {
          // LIST "" "" or LIST "" "INBOX" or LIST "" "*"
          if (args.includes('"" ""')) {
            send(`* LIST (\\Noselect) "/" ""`);
            send(`${tag} OK LIST completed`);
            break;
          }
          send(`* LIST (\\HasNoChildren) "/" "INBOX"`);
          send(`* LIST (\\HasNoChildren) "/" "Sent"`);
          send(`${tag} OK LIST completed`);
          break;
        }

        case "LSUB": {
          send(`${tag} OK LSUB completed`);
          break;
        }

        case "CLOSE": {
          send(`${tag} OK CLOSE completed`);
          break;
        }

        case "LOGIN": {
          // Syntax: LOGIN username password
          // Note: arguments may be quoted
          const match = args.match(
            /^("([^"]+)"|(\S+))\s+("([^"]+)"|(\S+))$/i,
          );
          let user = "";
          let pass = "";
          if (match) {
            user = match[2] ?? match[3] ?? "";
            pass = match[5] ?? match[6] ?? "";
          }

          this.authAttempts.push({ user, pass, secure: isSecure });

          const expectedUser = this.options.username ?? "test@example.com";
          const expectedPass = this.options.password ?? "secret123";

          if (user === expectedUser && pass === expectedPass) {
            send(`${tag} OK [CAPABILITY ${getCapabilityString(isSecure)}] Logged in`);
          } else {
            send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
          }
          break;
        }

        case "SELECT":
        case "EXAMINE": {
          const folder = args.replace(/^"|"$/g, "");
          _selectedFolder = folder;
          const msgCount = this.messages.size;
          send(`* ${msgCount} EXISTS`);
          send(`* 0 RECENT`);
          send(`* OK [UIDVALIDITY ${this.uidValidity}] UIDs valid`);
          send(`* OK [UIDNEXT ${this.uidNext}] Predicted next UID`);
          send(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)`);
          send(`${tag} OK [READ-WRITE] ${cmd} completed`);
          break;
        }

        case "STATUS": {
          // Syntax: STATUS folder (UIDVALIDITY UIDNEXT ...)
          const folderMatch = args.match(/^("([^"]+)"|(\S+))\s*\(([^)]+)\)/i);
          let folder = "INBOX";
          let items: string[] = [];
          if (folderMatch) {
            folder = folderMatch[2] ?? folderMatch[3] ?? "INBOX";
            items = folderMatch[4].split(/\s+/).map((s) => s.toUpperCase());
          }

          const statusParts: string[] = [];
          for (const item of items) {
            if (item === "UIDVALIDITY") {
              statusParts.push(`UIDVALIDITY ${this.uidValidity}`);
            } else if (item === "UIDNEXT") {
              statusParts.push(`UIDNEXT ${this.uidNext}`);
            } else if (item === "MESSAGES") {
              statusParts.push(`MESSAGES ${this.messages.size}`);
            } else if (item === "UNSEEN") {
              statusParts.push(`UNSEEN 0`);
            }
          }

          send(`* STATUS ${folder} (${statusParts.join(" ")})`);
          send(`${tag} OK STATUS completed`);
          break;
        }

        case "UID": {
          // Syntax: UID SEARCH ... or UID FETCH ...
          const uidRest = args;
          const uidSubSpaceIdx = uidRest.indexOf(" ");
          const uidSubCmd = (
            uidSubSpaceIdx === -1 ? uidRest : uidRest.slice(0, uidSubSpaceIdx)
          ).toUpperCase();
          const uidArgs = uidSubSpaceIdx === -1 ? "" : uidRest.slice(uidSubSpaceIdx + 1).trim();

          if (uidSubCmd === "SEARCH") {
            // Handle UID SEARCH UID x:*
            // ImapFlow sends e.g.: UID SEARCH UID 101:*
            let minUid = 1;
            const uidMatch = uidArgs.match(/UID\s+(\d+):\*/i);
            if (uidMatch) {
              minUid = parseInt(uidMatch[1], 10);
            }

            const matchingUids: number[] = [];
            for (const [uid] of this.messages.entries()) {
              if (uid >= minUid) {
                matchingUids.push(uid);
              }
            }
            matchingUids.sort((a, b) => a - b);
            send(`* SEARCH ${matchingUids.join(" ")}`.trimEnd());
            send(`${tag} OK SEARCH completed`);
          } else if (uidSubCmd === "FETCH") {
            // UID FETCH <uid-or-range> (...)
            const fetchMatch = uidArgs.match(/^(\d+(?::[\d*]+)?)\s*\((.+)\)$/i);
            if (!fetchMatch) {
              send(`${tag} BAD Invalid UID FETCH syntax`);
              break;
            }

            const rangeStr = fetchMatch[1];
            const fetchItems = fetchMatch[2].toUpperCase();

            // Resolve target UIDs
            const targetUids: number[] = [];
            if (rangeStr.includes(":")) {
              const [startStr, endStr] = rangeStr.split(":");
              const start = parseInt(startStr, 10);
              const end = endStr === "*" ? Infinity : parseInt(endStr, 10);
              for (const [uid] of this.messages.entries()) {
                if (uid >= start && uid <= end) targetUids.push(uid);
              }
            } else {
              const u = parseInt(rangeStr, 10);
              if (this.messages.has(u)) targetUids.push(u);
            }
            targetUids.sort((a, b) => a - b);

            for (const uid of targetUids) {
              const msg = this.messages.get(uid)!;
              const rawBytes = typeof msg.rawMime === "string"
                ? Buffer.from(msg.rawMime)
                : Buffer.from(msg.rawMime);
              const actualSize = rawBytes.length;
              const reportedSize = msg.advertisedSize ?? actualSize;

              const flagsStr = (msg.flags ?? []).join(" ");

              if (fetchItems.includes("RFC822.SIZE") && !fetchItems.includes("BODY")) {
                // Header or size fetch
                send(
                  `* ${uid} FETCH (UID ${uid} RFC822.SIZE ${reportedSize} FLAGS (${flagsStr}))`,
                );
              } else if (
                fetchItems.includes("BODY.PEEK[HEADER]") ||
                fetchItems.includes("RFC822.HEADER")
              ) {
                // Return header bytes
                let headerText = "";
                if (msg.headers) {
                  for (const [k, v] of Object.entries(msg.headers)) {
                    headerText += `${k}: ${v}\r\n`;
                  }
                  headerText += "\r\n";
                } else {
                  const s = rawBytes.toString("utf8");
                  const sep = s.indexOf("\r\n\r\n");
                  headerText = sep !== -1 ? s.slice(0, sep + 4) : s;
                }
                const headerBuf = Buffer.from(headerText);
                send(
                  `* ${uid} FETCH (UID ${uid} RFC822.SIZE ${reportedSize} FLAGS (${flagsStr}) BODY[HEADER] {${headerBuf.length}}`,
                );
                currentSocket.write(headerBuf);
                send(")");
              } else {
                // Full body/source fetch: BODY[] or RFC822
                // When testing size mismatch / server lying, server announces reportedSize in literal header
                // or sends rawBytes.length
                const bodyLiteralSize =
                  msg.advertisedSize !== undefined && msg.advertisedSize !== actualSize
                    ? actualSize
                    : reportedSize;
                send(
                  `* ${uid} FETCH (UID ${uid} RFC822.SIZE ${reportedSize} FLAGS (${flagsStr}) BODY[] {${bodyLiteralSize}}`,
                );
                currentSocket.write(rawBytes);
                send(")");
              }
            }

            send(`${tag} OK UID FETCH completed`);
          } else {
            send(`${tag} BAD Unknown UID sub-command`);
          }
          break;
        }

        case "APPEND": {
          // Syntax: APPEND folder (flags) {size}
          // The literal follows
          let folder = "Sent";
          const appendMatch = args.match(/^("([^"]+)"|(\S+))/i);
          if (appendMatch) {
            folder = (appendMatch[2] ?? appendMatch[3] ?? "Sent").replace(
              /^"|"$/g,
              "",
            );
          }

          this.appendedMessages.push({
            folder,
            content: new Uint8Array(accumulatedLiteral),
          });

          const newUid = this.uidNext++;
          send(`${tag} OK [APPENDUID ${this.uidValidity} ${newUid}] APPEND completed`);
          break;
        }

        case "LOGOUT": {
          send(`* BYE IMAP4rev1 Server logging out`);
          send(`${tag} OK LOGOUT completed`);
          currentSocket.end();
          break;
        }

        case "NOOP": {
          send(`${tag} OK NOOP completed`);
          break;
        }

        default: {
          send(`${tag} BAD Unsupported command: ${cmd}`);
          break;
        }
      }
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length > 0) {
        if (expectingLiteralBytes !== null) {
          if (buffer.length < expectingLiteralBytes) {
            // Not enough bytes yet
            return;
          }
          const literalChunk = buffer.subarray(0, expectingLiteralBytes);
          accumulatedLiteral = Buffer.concat([
            accumulatedLiteral,
            literalChunk,
          ]);
          buffer = buffer.subarray(expectingLiteralBytes);
          expectingLiteralBytes = null;

          // Now look for the trailing \r\n after the literal (or next command line)
          // Some IMAP commands continue on the line after literal
          const fullCmd = pendingCommandPrefix + " [LITERAL]";
          pendingCommandPrefix = "";
          processCommandLine(fullCmd);
          continue;
        }

        // Look for newline
        const nlIdx = buffer.indexOf("\n");
        if (nlIdx === -1) {
          // Incomplete line
          return;
        }

        const lineBuf = buffer.subarray(0, nlIdx);
        buffer = buffer.subarray(nlIdx + 1);

        let line = lineBuf.toString("utf8");
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (expectingAuthPlain) {
          this.executedCommands.push(`[SASL-PLAIN-RESPONSE ${line}]`);
          handlePlainAuth(pendingAuthTag, line);
          continue;
        }

        // Check for literal specification at end of line: {123} or {123+}
        const literalMatch = line.match(/\{(\d+)\+?\}$/);
        if (literalMatch) {
          const size = parseInt(literalMatch[1], 10);
          expectingLiteralBytes = size;
          pendingCommandPrefix = line;
          accumulatedLiteral = Buffer.alloc(0);

          if (!line.endsWith("+}") && !line.includes("+")) {
            // Send continuation request
            send("+ Ready for literal data");
          }
          continue;
        }

        processCommandLine(line);
      }
    };

    rawSocket.on("data", onData);
    rawSocket.on("error", () => {
      // ignore
    });
  }
}
