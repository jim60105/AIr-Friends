// tests/utils/runtime-platform.test.ts

import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { runtimeArch, runtimeOs } from "@utils/runtime-platform.ts";

test("runtimeArch - arm64 spelling", () => {
  assertEquals(runtimeArch("arm64"), "aarch64");
});

test("runtimeArch - canonical aarch64 spelling", () => {
  assertEquals(runtimeArch("aarch64"), "aarch64");
});

test("runtimeArch - x64 spelling", () => {
  assertEquals(runtimeArch("x64"), "x86_64");
  assertEquals(runtimeArch("amd64"), "x86_64");
});

test("runtimeArch - canonical x86_64 spelling", () => {
  assertEquals(runtimeArch("x86_64"), "x86_64");
});

test("runtimeArch - unknown machine", () => {
  assertEquals(runtimeArch("riscv64"), "riscv64");
});

test("runtimeOs - Windows platform", () => {
  assertEquals(runtimeOs("win32"), "windows");
});

test("runtimeOs - Linux platform", () => {
  assertEquals(runtimeOs("linux"), "linux");
});
