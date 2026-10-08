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
    () => client.request("i", {}),
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
    () => client.request("i", {}),
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
    () => client.request("i", {}),
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

Deno.test("MisskeyClient.uploadFile - reports the status and body of a JSON API error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json(
        { error: { code: "RESTRICTED_BY_ROLE", message: "File type is not allowed" } },
        { status: 400 },
      ),
    );

  try {
    const client = new MisskeyClient(createTestConfig());
    const error = await assertRejects(
      () => client.uploadFile(new Uint8Array([1, 2, 3]), "test.png"),
      PlatformError,
    );
    assertEquals(error.code, ErrorCode.PLATFORM_API_ERROR);
    assertEquals(error.isRetryable, false);
    assertEquals(error.message.includes("400"), true);
    assertEquals(error.message.includes("RESTRICTED_BY_ROLE"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("MisskeyClient.uploadFile - sends the SDK's multipart body and returns the file id and url", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: string | undefined;
  let requestInit: RequestInit | undefined;
  let requestBody: FormData | undefined;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    requestBody = init?.body as FormData;
    return Promise.resolve(
      Response.json({ id: "file123", url: "https://example.com/photo.png" }),
    );
  };

  try {
    const client = new MisskeyClient(createTestConfig());
    const result = await client.uploadFile(new Uint8Array([1, 2, 3]), "photo.png");

    assertEquals(result, { id: "file123", url: "https://example.com/photo.png" });
    assertEquals(requestUrl, "http://localhost/api/drive/files/create");
    assertEquals(requestInit?.method, "POST");

    // The SDK builds the multipart body: the credential, the name field, and
    // the file (keeping its filename) all travel as form entries.
    assertEquals(requestBody?.get("i"), "test-token");
    assertEquals(requestBody?.get("name"), "photo.png");
    const uploaded = requestBody?.get("file");
    assertEquals(uploaded instanceof File, true);
    assertEquals((uploaded as File).name, "photo.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * Compile-time guard: a misspelled request field on a real endpoint must not
 * type-check. `includeReplies` on `users/notes` is the typo this change exists
 * to prevent (`deno test` type-checks test files, `deno task check` does not
 * read them).
 */
const requestWithMisspelledUsersNotesField: (client: MisskeyClient) => Promise<unknown> = (
  client,
) => {
  // @ts-expect-error - `includeReplies` is not a `users/notes` parameter
  return client.request("users/notes", { userId: "user1", includeReplies: false });
};

Deno.test("MisskeyClient.request - rejects an unknown request field at compile time", () => {
  // The fixture above is never called; referencing it keeps it in the module
  // (and therefore type-checked) instead of leaving it commented out.
  assertEquals(typeof requestWithMisspelledUsersNotesField, "function");
});

/** The private client fields the transport tests observe. */
interface ClientInternals {
  api: { fetch: unknown };
}

/**
 * The shared SDK client the unsignaled path must keep using. A narrow
 * structural view avoids widening the production class for tests.
 */
function sharedApiOf(client: MisskeyClient): ClientInternals {
  // The SDK client is private; this view is the only shape these tests read.
  return client as unknown as ClientInternals;
}

Deno.test("MisskeyClient.request - a signaled call applies the signal to the transport fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let seenSignal: AbortSignal | null | undefined;
  let seenBody: string | undefined;

  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    seenSignal = init?.signal;
    seenBody = typeof init?.body === "string" ? init.body : undefined;
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  };

  try {
    const client = new MisskeyClient(createTestConfig());

    await assertRejects(
      () => client.request("notes/show", { noteId: "n1" }, { signal: controller.signal }),
      DOMException,
    );

    assertEquals(seenSignal, controller.signal);
    // The signal is transport state, never part of the endpoint JSON payload.
    assertEquals(seenBody, JSON.stringify({ noteId: "n1", i: "test-token" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("MisskeyClient.request - aborting the signal cancels the pending response body read", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    const json = Promise.withResolvers<unknown>();
    init?.signal?.addEventListener(
      "abort",
      () => json.reject(new DOMException("The operation was aborted.", "AbortError")),
    );
    // Headers have arrived and the SDK is still reading the body: only `status`
    // and `json()` are part of the transport contract the SDK reads.
    return Promise.resolve({ status: 200, json: () => json.promise } as unknown as Response);
  };

  try {
    const client = new MisskeyClient(createTestConfig());
    const pending = client.request("notes/show", { noteId: "n1" }, { signal: controller.signal });
    controller.abort();

    await assertRejects(() => pending, DOMException);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("MisskeyClient.request - a signaled call leaves the shared SDK client untouched", async () => {
  const originalFetch = globalThis.fetch;
  let transports = 0;

  globalThis.fetch = () => {
    transports++;
    return Promise.resolve(Response.json({ id: "note1" }));
  };

  try {
    const client = new MisskeyClient(createTestConfig());
    const sharedFetch = sharedApiOf(client).api.fetch;
    const controller = new AbortController();

    await client.request("notes/show", { noteId: "n1" }, { signal: controller.signal });
    assertEquals(sharedApiOf(client).api.fetch, sharedFetch);

    // The unsignaled path still runs through the shared client.
    await client.request("notes/show", { noteId: "n2" });
    assertEquals(transports, 2);
    assertEquals(sharedApiOf(client).api.fetch, sharedFetch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * Compile-time guard: an abort signal is request options, not an endpoint
 * parameter, so it can never travel inside the endpoint JSON.
 */
const requestWithSignalParameter: (client: MisskeyClient) => Promise<unknown> = (client) => {
  // @ts-expect-error - `signal` is not a `notes/show` parameter
  return client.request("notes/show", { noteId: "n1", signal: new AbortController().signal });
};

Deno.test("MisskeyClient.request - rejects a signal inside the endpoint parameters at compile time", () => {
  assertEquals(typeof requestWithSignalParameter, "function");
});
