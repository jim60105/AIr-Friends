/**
 * Backpressure fixture: writes `totalBytes` of stdout in 64 KiB chunks and
 * records the cumulative byte count after every chunk, so a stalled consumer is
 * observable as a progress value that stops advancing.
 *
 * Short `write(2)` results are normal once pipe backpressure engages, so each
 * chunk is written through a loop instead of assuming one call writes it all.
 */
import { renameSync, writeFileSync, writeSync } from "node:fs";

const CHUNK_BYTES = 64 * 1024;
const EAGAIN = "EAGAIN";

const totalBytes = Number.parseInt(process.argv[2] ?? "", 10);
const progressFile = process.argv[3] ?? "";
if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || progressFile === "") {
  console.error("usage: producer.ts <totalBytes> <progressFile>");
  process.exit(2);
}

const chunk = Buffer.alloc(CHUNK_BYTES, 0x61);

function writeChunk(fd: number, size: number): void {
  let offset = 0;
  while (offset < size) {
    try {
      offset += writeSync(fd, chunk, offset, size - offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === EAGAIN) continue;
      throw error;
    }
  }
}

let written = 0;
while (written < totalBytes) {
  const size = Math.min(CHUNK_BYTES, totalBytes - written);
  writeChunk(1, size);
  written += size;
  // Rename over the progress file so a concurrent reader never sees a
  // truncated intermediate value.
  writeFileSync(`${progressFile}.tmp`, String(written));
  renameSync(`${progressFile}.tmp`, progressFile);
}
