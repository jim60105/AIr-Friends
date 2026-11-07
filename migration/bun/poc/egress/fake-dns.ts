// migration/bun/poc/egress/fake-dns.ts
//
// Minimal UDP DNS server for the egress suite (design D3). It answers A and AAAA queries
// from a caller-supplied function, so resolver behavior — including a rebinding answer
// sequence — is exercised through the real `node:dns/promises` code path instead of a
// stubbed seam.

import { createSocket } from "node:dgram";
import { Resolver } from "node:dns/promises";
import type { EgressResolver } from "./egress-proxy.ts";

export type DnsAnswer = (name: string, type: "A" | "AAAA", queryIndex: number) => string[];

export interface FakeDns {
  port: number;
  queries(): { name: string; type: "A" | "AAAA" }[];
  resolver(): EgressResolver;
  stop(): void;
}

const QTYPES = { A: 1, AAAA: 28 } as const;

/** Reads a length-prefixed DNS name; returns the dotted name and the offset after the root. */
function readName(message: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let pos = offset;
  for (;;) {
    const length = message[pos];
    if (length === undefined) throw new Error("truncated DNS name");
    if (length === 0) {
      pos += 1;
      break;
    }
    labels.push(message.subarray(pos + 1, pos + 1 + length).toString("latin1"));
    pos += 1 + length;
  }
  return { name: labels.join("."), next: pos };
}

/** Encodes an IPv6 literal as its 16 bytes, expanding `::`. */
function ipv6Bytes(addr: string): Buffer {
  const halves = addr.split("::");
  if (halves.length > 2) throw new Error(`invalid IPv6 address: ${addr}`);
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const groups = halves.length === 2
    ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
    : head;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) {
    throw new Error(`invalid IPv6 address: ${addr}`);
  }
  const out = Buffer.alloc(16);
  groups.forEach((group, index) => {
    out.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  });
  return out;
}

/** Encodes an IPv4 literal as its 4 bytes. */
function ipv4Bytes(addr: string): Buffer {
  const octets = addr.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`invalid IPv4 address: ${addr}`);
  }
  return Buffer.from(octets);
}

/** Builds the response record stream for one query. */
function respond(message: Buffer, answers: string[], type: "A" | "AAAA"): Buffer {
  const question = readName(message, 12);
  const questionSection = message.subarray(12, question.next + 4);
  const header = Buffer.alloc(12);
  message.copy(header, 0, 0, 2); // echo the query id
  header[2] = 0x81; // QR + RD
  header[3] = 0x80; // RA, RCODE 0 (no error)
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(answers.length, 6); // ANCOUNT
  const records = answers.map((address) => {
    const rdata = type === "A" ? ipv4Bytes(address) : ipv6Bytes(address);
    const record = Buffer.alloc(12);
    record[0] = 0xc0; // name pointer to the question's name
    record[1] = 0x0c;
    record.writeUInt16BE(QTYPES[type], 2);
    record.writeUInt16BE(1, 4); // class IN
    record.writeUInt32BE(0, 6); // TTL 0
    record.writeUInt16BE(rdata.length, 10);
    return Buffer.concat([record, rdata]);
  });
  return Buffer.concat([header, questionSection, ...records]);
}

/**
 * Starts a UDP DNS server on an ephemeral loopback port. `answer` is called per query with
 * the query name, its family and the number of earlier queries for that same name and family,
 * so a test can return a different address on the second answer (rebinding).
 */
export function startFakeDns(answer: DnsAnswer): Promise<FakeDns> {
  const socket = createSocket("udp4");
  const seen: { name: string; type: "A" | "AAAA" }[] = [];
  const counts = new Map<string, number>();

  socket.on("message", (message, remote) => {
    try {
      const { name, next } = readName(message, 12);
      const qtype = message.readUInt16BE(next);
      const type = qtype === QTYPES.A ? "A" : qtype === QTYPES.AAAA ? "AAAA" : null;
      if (type === null) return;
      seen.push({ name, type });
      const key = `${name}|${type}`;
      const queryIndex = counts.get(key) ?? 0;
      counts.set(key, queryIndex + 1);
      socket.send(respond(message, answer(name, type, queryIndex), type), remote.port, remote.address);
    } catch {
      // A malformed query is dropped; the resolver then retries or reports the failure.
    }
  });

  const { promise, resolve, reject } = Promise.withResolvers<FakeDns>();
  socket.once("error", reject);
  socket.bind(0, "127.0.0.1", () => {
    socket.off("error", reject);
    const port = socket.address().port;
    resolve({
      port,
      queries: () => [...seen],
      resolver: () => {
        const resolver = new Resolver();
        resolver.setServers([`127.0.0.1:${port}`]);
        return resolver;
      },
      stop: () => {
        socket.close();
      },
    });
  });
  return promise;
}
