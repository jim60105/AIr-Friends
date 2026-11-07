/**
 * Concurrent-stream fixture: alternates 64 KiB writes to stderr and stdout and
 * stops after `bytesEach` bytes per stream, so a suite can prove the boundary
 * does not stall while stderr is drained alongside stdout.
 *
 * Short `write(2)` results are normal once pipe backpressure engages, so each
 * chunk is written through a loop instead of assuming one call writes it all.
 */
import { writeSync } from "node:fs";

const CHUNK_BYTES = 64 * 1024;
const EAGAIN = "EAGAIN";

const bytesEach = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isSafeInteger(bytesEach) || bytesEach <= 0) {
  console.error("usage: dual-writer.ts <bytesEach>");
  process.exit(2);
}

const chunk = Buffer.alloc(CHUNK_BYTES, 0x62);

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

for (let written = 0; written < bytesEach; written += CHUNK_BYTES) {
  const size = Math.min(CHUNK_BYTES, bytesEach - written);
  writeChunk(2, size);
  writeChunk(1, size);
}
