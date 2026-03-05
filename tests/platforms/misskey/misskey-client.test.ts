// tests/platforms/misskey/misskey-client.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { MisskeyClient } from "@platforms/misskey/misskey-client.ts";
import { ErrorCode, PlatformError } from "../../../src/types/errors.ts";
import { MisskeyAdapterConfig } from "@platforms/misskey/misskey-config.ts";

function createTestConfig(): MisskeyAdapterConfig {
  return {
    host: "localhost",
    token: "test-token",
    secure: false,
    allowDm: false,
    respondToMention: true,
  };
}

function createClient(
  overrides?: Partial<{ apiRequest: (endpoint: string, params: unknown) => Promise<unknown> }>,
): MisskeyClient {
  const client = new MisskeyClient(createTestConfig());

  if (overrides?.apiRequest) {
    // Replace internal api.request with mock
    // deno-lint-ignore no-explicit-any
    (client as any).api = {
      // deno-lint-ignore no-explicit-any
      ...(client as any).api,
      request: overrides.apiRequest,
    };
  }

  return client;
}

Deno.test("MisskeyClient.request - throws PlatformError on non-JSON response", async () => {
  const syntaxError = new SyntaxError(
    "Unexpected token 'B', \"Bad Gateway\" is not valid JSON",
  );
  const client = createClient({
    apiRequest: () => Promise.reject(syntaxError),
  });

  const error = await assertRejects(
    () => client.request("i"),
    PlatformError,
  );
  assertEquals(error.code, ErrorCode.PLATFORM_CONNECTION_FAILED);
  assertEquals(error.isRetryable, true);
});

Deno.test("MisskeyClient.request - passes through normal API errors unchanged", async () => {
  const apiError = new Error("AUTHENTICATION_FAILED");
  const client = createClient({
    apiRequest: () => Promise.reject(apiError),
  });

  await assertRejects(
    () => client.request("i"),
    Error,
    "AUTHENTICATION_FAILED",
  );
});

Deno.test("MisskeyClient.request - does not catch non-JSON SyntaxError", async () => {
  const syntaxError = new SyntaxError("Unexpected identifier");
  const client = createClient({
    apiRequest: () => Promise.reject(syntaxError),
  });

  await assertRejects(
    () => client.request("i"),
    SyntaxError,
    "Unexpected identifier",
  );
});

Deno.test("MisskeyClient.uploadFile - throws PlatformError on 502 response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
    );

  try {
    const client = new MisskeyClient(createTestConfig());
    const error = await assertRejects(
      () => client.uploadFile(new Uint8Array([1, 2, 3]), "test.png"),
      PlatformError,
    );
    assertEquals(error.code, ErrorCode.PLATFORM_CONNECTION_FAILED);
    assertEquals(error.isRetryable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("MisskeyClient.uploadFile - throws PlatformError(API_ERROR) on 400 response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("Bad Request", { status: 400, statusText: "Bad Request" }),
    );

  try {
    const client = new MisskeyClient(createTestConfig());
    const error = await assertRejects(
      () => client.uploadFile(new Uint8Array([1, 2, 3]), "test.png"),
      PlatformError,
    );
    assertEquals(error.code, ErrorCode.PLATFORM_API_ERROR);
    assertEquals(error.isRetryable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
