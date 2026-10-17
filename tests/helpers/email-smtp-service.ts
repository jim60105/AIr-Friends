// tests/helpers/email-smtp-service.ts
//
// In-process deterministic SMTP submission fixture for EmailSmtpClient tests.
// Supports direct TLS (SMTPS style) and plain TCP with mandatory STARTTLS, implementing the
// subset used by the transport: greeting, EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL, RCPT,
// DATA, QUIT, plus scripted fault modes (refused STARTTLS, rejected authentication and
// envelopes, rejected final response, lost acknowledgement, stalled connection, truncated
// acknowledgement, advertised SIZE limit).
//
// The fixture decodes the DATA payload exactly as the wire delivers it: dot-unstuffing and
// dropping the terminating `<CR><LF>.<CR><LF>` (messages are expected to be CRLF-terminated).

import * as net from "node:net";
import * as tls from "node:tls";
import { getOrCreateFixtureCert } from "./email-imap-service.ts";

export interface SmtpFixtureOptions {
  host?: string;
  port?: number;
  tlsMode: "tls" | "starttls";
  username?: string;
  password?: string;
  /** Advertise and accept STARTTLS; when false the server refuses the command. */
  supportStartTls?: boolean;
  /** Reply 535 to every authentication attempt. */
  rejectAuth?: boolean;
  /** Reply 550 to MAIL FROM. */
  rejectMailFrom?: boolean;
  /** Reply 550 to RCPT TO. */
  rejectRecipient?: boolean;
  /** Reply 554 to the DATA command itself. */
  rejectDataCommand?: boolean;
  /** Final DATA response code; 4xx/5xx mean explicit rejection. */
  finalResponseCode?: number;
  /** Raw final DATA response text (e.g. `2500 2.0.0 Ok`), overriding the code form. */
  finalResponseText?: string;
  /** Consume the DATA payload, then close the socket without any final reply. */
  closeAfterPayload?: boolean;
  /** Consume the DATA payload and stay silent (no final reply, socket stays open). */
  stallAfterPayload?: boolean;
  /** Consume the DATA payload, write this acknowledgement without CRLF, then close. */
  truncatedResponseAfterPayload?: string;
  /** Advertise `SIZE <n>` in EHLO so provider size limits can be exercised. */
  announceMaxSize?: number;
  /** Reply 421 to the greeting and close immediately. */
  refuseGreeting?: boolean;
}

/** One decoded DATA transaction observed by the fixture. */
export interface SmtpDataTransaction {
  envelopeFrom: string;
  recipients: string[];
  /** Wire-decoded message bytes (dot-unstuffed, terminator removed). */
  decoded: Uint8Array;
}

/** One authentication attempt observed by the fixture. */
export interface SmtpAuthAttempt {
  user: string;
  pass: string;
  secure: boolean;
}

const DATA_TERMINATOR = Buffer.from("\r\n.\r\n");

/** Remove SMTP dot-stuffing from a decoded DATA payload line by line. */
function dotUnstuff(payload: Buffer): Uint8Array {
  const text = payload.toString("binary");
  const lines = text.split("\r\n");
  const unstuffed = lines.map((line) => line.startsWith(".") ? line.slice(1) : line);
  return Buffer.from(unstuffed.join("\r\n"), "binary");
}

export class EmailSmtpTestService {
  private server: net.Server | tls.Server | null = null;
  private readonly options: SmtpFixtureOptions;
  private readonly sockets = new Set<net.Socket | tls.TLSSocket>();

  public port = 0;
  public host: string;
  public caCert: string;
  public authAttempts: SmtpAuthAttempt[] = [];
  public executedCommands: string[] = [];
  public dataTransactions: SmtpDataTransaction[] = [];

  constructor(options: SmtpFixtureOptions) {
    this.options = options;
    this.host = options.host ?? "127.0.0.1";
    this.caCert = getOrCreateFixtureCert().cert;
  }

  /** Number of DATA transactions observed (each submission must produce at most one). */
  get dataTransactionCount(): number {
    return this.dataTransactions.length;
  }

  /** True when any command was received after the DATA payload was consumed. */
  get postDataCommands(): string[] {
    return this.executedCommands.slice(this.postDataCommandOffset);
  }

  private postDataCommandOffset = 0;

  /** Bind a unique port and start accepting connections. */
  async start(): Promise<number> {
    const certData = getOrCreateFixtureCert();

    if (this.options.tlsMode === "tls") {
      this.server = tls.createServer(
        { cert: certData.cert, key: certData.key },
        (socket) => this.handleConnection(socket, true),
      );
    } else {
      this.server = net.createServer((socket) => this.handleConnection(socket, false));
    }

    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => {
        this.sockets.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.options.port ?? 0, this.host, () => {
        const address = this.server?.address();
        if (address && typeof address === "object") {
          this.port = address.port;
          resolve();
        } else {
          reject(new Error("Unable to obtain bound port"));
        }
      });
      this.server?.on("error", reject);
    });

    return this.port;
  }

  /** Bounded shutdown: destroy live sockets, then close the listener. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2_000);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private handleConnection(
    rawSocket: net.Socket | tls.TLSSocket,
    initiallySecure: boolean,
  ): void {
    let currentSocket: net.Socket | tls.TLSSocket = rawSocket;
    let secure = initiallySecure;
    let readBuffer = Buffer.alloc(0);
    let dataBuffer = Buffer.alloc(0);
    let inData = false;
    let envelopeFrom = "";
    let recipients: string[] = [];
    let expectingAuthLoginUser = false;
    let expectingAuthLoginPass = false;
    let authUser = "";
    let awaitingStartTlsUpgrade = false;

    const write = (line: string): void => {
      if (currentSocket.writable) {
        currentSocket.write(line + "\r\n");
      }
    };

    const resetTranscript = (): void => {
      readBuffer = Buffer.alloc(0);
    };

    const completeTransaction = (): void => {
      // The wire payload is `message` + the terminating `.<CR><LF>`; a CRLF-terminated
      // message therefore round-trips byte-exactly after removing those 3 bytes.
      this.dataTransactions.push({
        envelopeFrom,
        recipients: [...recipients],
        decoded: new Uint8Array(
          dotUnstuff(dataBuffer.subarray(0, Math.max(0, dataBuffer.length - 3))),
        ),
      });
      this.postDataCommandOffset = this.executedCommands.length;
      inData = false;
      dataBuffer = Buffer.alloc(0);
    };

    const ehloLines = (): string[] => {
      const lines = ["250-fixture.example", "250-PIPELINING", "250-8BITMIME"];
      if (!this.options.rejectAuth) {
        lines.push("250-AUTH PLAIN LOGIN");
      }
      if (
        this.options.tlsMode === "starttls" && !secure &&
        (this.options.supportStartTls ?? true)
      ) {
        lines.push("250-STARTTLS");
      }
      if (this.options.announceMaxSize !== undefined) {
        lines.push(`250-SIZE ${this.options.announceMaxSize}`);
      }
      lines.push("250 HELP");
      return lines;
    };

    const upgradeToTls = (): void => {
      const certData = getOrCreateFixtureCert();
      const secureContext = tls.createSecureContext({
        cert: certData.cert,
        key: certData.key,
      });
      awaitingStartTlsUpgrade = true;
      write("220 2.0.0 Ready to start TLS");
      const plainSocket = currentSocket as net.Socket;
      plainSocket.removeAllListeners("data");
      const tlsSocket = new tls.TLSSocket(plainSocket, {
        isServer: true,
        secureContext,
      });
      currentSocket = tlsSocket;
      secure = true;
      awaitingStartTlsUpgrade = false;
      resetTranscript();
      tlsSocket.on("data", onData);
      tlsSocket.on("error", () => {
        this.sockets.delete(tlsSocket);
      });
    };

    const handleAuthPlain = (payload: string): void => {
      const decoded = Buffer.from(payload, "base64").toString("binary");
      const parts = decoded.split("\0");
      const user = parts.length >= 3 ? parts[1] : "";
      const pass = parts.length >= 3 ? parts[2] : "";
      this.authAttempts.push({ user, pass, secure });
      if (
        !this.options.rejectAuth && user === (this.options.username ?? "test@example.com") &&
        pass === (this.options.password ?? "secret123")
      ) {
        write("235 2.7.0 Authentication successful");
      } else {
        write("535 5.7.8 Authentication credentials invalid");
      }
    };

    const handleCommand = (line: string): void => {
      this.executedCommands.push(line);
      const spaceIndex = line.indexOf(" ");
      const command = (spaceIndex === -1 ? line : line.slice(0, spaceIndex)).toUpperCase();
      const args = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1).trim();

      if (expectingAuthLoginPass) {
        expectingAuthLoginPass = false;
        this.authAttempts.push({
          user: authUser,
          pass: Buffer.from(args, "base64").toString("binary"),
          secure,
        });
        const last = this.authAttempts[this.authAttempts.length - 1];
        if (
          !this.options.rejectAuth && last.user === (this.options.username ?? "test@example.com") &&
          last.pass === (this.options.password ?? "secret123")
        ) {
          write("235 2.7.0 Authentication successful");
        } else {
          write("535 5.7.8 Authentication credentials invalid");
        }
        return;
      }
      if (expectingAuthLoginUser) {
        expectingAuthLoginUser = false;
        authUser = Buffer.from(args, "base64").toString("binary");
        expectingAuthLoginPass = true;
        write("334 UGFzc3dvcmQ6");
        return;
      }

      switch (command) {
        case "EHLO":
        case "HELO": {
          if (command === "EHLO") {
            for (const ehloLine of ehloLines()) {
              write(ehloLine);
            }
          } else {
            write("250 fixture.example");
          }
          break;
        }

        case "STARTTLS": {
          if (
            this.options.tlsMode !== "starttls" || secure ||
            !(this.options.supportStartTls ?? true)
          ) {
            write("502 5.5.1 STARTTLS not supported");
            break;
          }
          upgradeToTls();
          break;
        }

        case "AUTH": {
          const mechanism = args.split(/\s+/)[0]?.toUpperCase();
          const initialResponse = args.split(/\s+/)[1];
          if (mechanism === "PLAIN") {
            if (initialResponse) {
              handleAuthPlain(initialResponse);
            } else {
              write("334 ");
            }
            break;
          }
          if (mechanism === "LOGIN") {
            if (initialResponse) {
              expectingAuthLoginPass = true;
              authUser = Buffer.from(initialResponse, "base64").toString("binary");
              write("334 UGFzc3dvcmQ6");
            } else {
              expectingAuthLoginUser = true;
              write("334 VXNlcm5hbWU6");
            }
            break;
          }
          write("504 5.5.4 Unrecognized authentication type");
          break;
        }

        case "MAIL": {
          envelopeFrom = (args.match(/<([^>]*)>/) ?? [])[1] ?? "";
          recipients = [];
          write(
            this.options.rejectMailFrom
              ? "550 5.1.8 Sender address rejected"
              : "250 2.1.0 Sender OK",
          );
          break;
        }

        case "RCPT": {
          const recipient = (args.match(/<([^>]*)>/) ?? [])[1] ?? "";
          if (this.options.rejectRecipient) {
            write("550 5.1.1 Recipient address rejected");
            break;
          }
          recipients.push(recipient);
          write("250 2.1.5 Recipient OK");
          break;
        }

        case "DATA": {
          if (this.options.rejectDataCommand) {
            write("554 5.5.1 DATA command rejected");
            break;
          }
          inData = true;
          dataBuffer = Buffer.alloc(0);
          write("354 End data with <CR><LF>.<CR><LF>");
          break;
        }

        case "QUIT": {
          write("221 2.0.0 Bye");
          currentSocket.end();
          break;
        }

        case "RSET": {
          envelopeFrom = "";
          recipients = [];
          write("250 2.0.0 OK");
          break;
        }

        case "NOOP": {
          write("250 2.0.0 OK");
          break;
        }

        default: {
          write("500 5.5.2 Command unrecognized");
          break;
        }
      }
    };

    const handleCompleteData = (): void => {
      completeTransaction();
      if (this.options.closeAfterPayload) {
        currentSocket.destroy();
        return;
      }
      if (this.options.stallAfterPayload) {
        return;
      }
      if (this.options.truncatedResponseAfterPayload !== undefined) {
        // `end()` flushes the deliberately incomplete reply before closing the stream,
        // so the client observes the reply rather than an empty connection loss.
        currentSocket.end(this.options.truncatedResponseAfterPayload);
        return;
      }
      if (this.options.finalResponseText !== undefined) {
        write(this.options.finalResponseText);
        return;
      }
      const code = this.options.finalResponseCode ?? 250;
      write(`${code} 2.0.0 Ok: queued as FIXTURE`);
    };

    const onData = (chunk: Buffer): void => {
      if (awaitingStartTlsUpgrade) {
        return;
      }
      if (inData) {
        dataBuffer = Buffer.concat([dataBuffer, chunk]);
        const terminatorIndex = dataBuffer.indexOf(DATA_TERMINATOR);
        if (terminatorIndex === -1) {
          return;
        }
        const remainder = dataBuffer.subarray(terminatorIndex + DATA_TERMINATOR.length);
        dataBuffer = dataBuffer.subarray(0, terminatorIndex + DATA_TERMINATOR.length);
        handleCompleteData();
        readBuffer = Buffer.concat([readBuffer, remainder]);
        drainLines();
        return;
      }
      readBuffer = Buffer.concat([readBuffer, chunk]);
      drainLines();
    };

    const drainLines = (): void => {
      while (true) {
        if (inData) {
          return;
        }
        const newlineIndex = readBuffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }
        let line = readBuffer.subarray(0, newlineIndex).toString("utf8");
        readBuffer = readBuffer.subarray(newlineIndex + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if (line.length === 0) {
          continue;
        }
        handleCommand(line);
      }
    };

    if (this.options.refuseGreeting) {
      write("421 4.3.2 Service not available");
      currentSocket.end();
      return;
    }

    this.sockets.add(rawSocket);
    rawSocket.on("close", () => this.sockets.delete(rawSocket));
    rawSocket.on("error", () => this.sockets.delete(rawSocket));

    write("220 fixture.example ESMTP ready");
    rawSocket.on("data", onData);
  }
}
