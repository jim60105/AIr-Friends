import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { machine } from "node:os";
import { getgid, getuid } from "node:process";
import { OWNED_DEBIAN_LIBC_PATHS } from "../../../../src/acp/filesystem-access-linux.ts";
import { POC_PINS } from "../gate/pins.ts";
import { normalizeArch, observe } from "../gate/evidence.ts";

describe("poc runtime", () => {
  test("is the pinned Bun", () => {
    observe("bunVersion", Bun.version);
    observe("bunRevision", Bun.revision);
    expect(Bun.version).toBe(POC_PINS.bunVersion);
    expect(Bun.revision.startsWith(POC_PINS.bunRevisionPrefix)).toBe(true);
  });

  test("has the owned Debian libc path for the running architecture", () => {
    const architecture = normalizeArch(machine());
    const libcPath = OWNED_DEBIAN_LIBC_PATHS[architecture];
    observe("libcPath", libcPath ?? null);
    expect(libcPath).toBeDefined();
    expect(existsSync(libcPath!)).toBe(true);
  });

  test("runs dumb-init", () => {
    const result = Bun.spawnSync(["dumb-init", "--version"], { stdout: "pipe", stderr: "pipe" });
    // `dumb-init --version` writes its banner to stderr.
    const version = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    observe("dumbInitVersion", version);
    expect(result.exitCode).toBe(0);
    expect(version).not.toBe("");
  });

  test("runs as UID 1000 and GID 0", () => {
    observe("uid", getuid());
    observe("gid", getgid());
    expect(getuid()).toBe(1000);
    expect(getgid()).toBe(0);
  });
});
