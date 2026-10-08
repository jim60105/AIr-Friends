// src/platforms/misskey/misskey-client.ts

import { api as MisskeyApi, type Endpoints, Stream } from "misskey-js";
import { MisskeyAdapterConfig } from "./misskey-config.ts";
import { createLogger } from "@utils/logger.ts";
import { ErrorCode, PlatformError } from "../../types/errors.ts";

const logger = createLogger("MisskeyClient");

/** Parameters accepted by a misskey-js endpoint. */
type RequestParams<E extends keyof Endpoints> = Endpoints[E]["req"];

/** Response returned by a misskey-js endpoint for concrete parameters. */
type RequestResponse<E extends keyof Endpoints, P extends RequestParams<E>> =
  MisskeyApi.SwitchCaseResponseType<E, P>;

/**
 * Keys of an endpoint's request type, distributed over union request types
 * (`users/show`, for example, accepts a union of parameter shapes whose keys
 * computed with plain `keyof` would collapse to `never`).
 */
type RequestKeys<E extends keyof Endpoints> = RequestParams<E> extends infer R
  ? R extends unknown ? keyof R : never
  : never;

/**
 * A request's parameters plus `never` for every key the endpoint does not
 * accept.
 *
 * Governing the parameter type by the *inferred* argument type (rather than
 * relying on generic inference alone) is what makes an unknown request field a
 * compile error: excess property checks do not run against a type parameter
 * constraint, so a misspelled field such as the historical `includeReplies`
 * would otherwise compile and only fail at the server.
 *
 * Note the limit of this check: it validates the set of keys, not which
 * combination of optional keys belongs to one variant of a union request type.
 * Endpoints whose request type has an index signature (the SDK's `EmptyRequest`
 * for `i` and `emojis`) accept any key by construction.
 */
type StrictParams<E extends keyof Endpoints, P> =
  & P
  & Record<Exclude<keyof P, RequestKeys<E>>, never>;

/**
 * Forward a request to the SDK's `APIClient.request`.
 *
 * misskey-js declares `request` as one overload per endpoint, which TypeScript
 * cannot resolve from a generic endpoint value, and the package exports no
 * generic request type. The overload set is exactly the generic form asserted
 * here, so the assertion is sound; the public `request()` signature carries the
 * endpoint typing. `this` is bound explicitly because the SDK method reads
 * `this.origin` / `this.credential` / `this.fetch`.
 */
function forwardRequest<E extends keyof Endpoints, P extends RequestParams<E>>(
  api: MisskeyApi.APIClient,
  endpoint: E,
  params: P,
): Promise<RequestResponse<E, P>> {
  const request = api.request as unknown as (
    this: MisskeyApi.APIClient,
    endpoint: E,
    params: P,
  ) => Promise<RequestResponse<E, P>>;

  return request.call(api, endpoint, params);
}

/**
 * `fetch` adapter for Drive uploads.
 *
 * The SDK parses the response body before it looks at the HTTP status, so an
 * upload failure would reach callers as a bare JSON `SyntaxError` (a gateway's
 * non-JSON body) or as the server's error object with the status discarded —
 * losing the retryability classification the upload path has always applied.
 * Classifying the status in the SDK's injectable transport keeps that contract
 * while the endpoint, credential, and multipart encoding stay the SDK's.
 */
const uploadFetch: MisskeyApi.FetchLike = async (input, init) => {
  const response = await fetch(input, init);

  // The SDK resolves only 200 and 204; every other status is a failure here so
  // the classification below is the single owner of the upload error contract.
  if (response.status !== 200 && response.status !== 204) {
    const body = await response.text();
    const context = { endpoint: "drive/files/create", status: response.status };

    // HTTP 502/503/504 indicate gateway-level issues
    if (response.status >= 502 && response.status <= 504) {
      throw new PlatformError(
        ErrorCode.PLATFORM_CONNECTION_FAILED,
        `Misskey server unavailable (${response.status}): ${body}`,
        context,
      );
    }

    throw new PlatformError(
      ErrorCode.PLATFORM_API_ERROR,
      `Drive upload failed (${response.status}): ${body}`,
      context,
    );
  }

  return { status: response.status, json: () => response.json() };
};

/**
 * Misskey client wrapper
 */
export class MisskeyClient {
  private readonly api: MisskeyApi.APIClient;
  private readonly uploadApi: MisskeyApi.APIClient;
  private readonly origin: string;
  private stream: Stream | null = null;
  private readonly config: MisskeyAdapterConfig;

  constructor(config: MisskeyAdapterConfig) {
    this.config = config;

    const origin = `${config.secure ? "https" : "http"}://${config.host}`;
    this.origin = origin;
    this.api = new MisskeyApi.APIClient({
      origin,
      credential: config.token,
    });
    // Uploads classify HTTP failures by status (see `uploadFetch`), which the
    // SDK's own error contract cannot express. Every other endpoint keeps the
    // SDK's error shape unchanged: the adapter's fork-compatibility fallback
    // reads the server error code off it.
    this.uploadApi = new MisskeyApi.APIClient({
      origin,
      credential: config.token,
      fetch: uploadFetch,
    });
  }

  /**
   * Get the API client. Drive uploads deliberately run through a separate
   * client with a status-classifying `fetch` (see `uploadFile`), so callers
   * must not route multipart requests through this one.
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
   * Make an API request with the endpoint's own parameter and response types.
   *
   * An endpoint the server does not have, an unknown request field, or a field
   * of the wrong shape fails type-checking instead of failing at the server.
   *
   * A caller that supplies an abort `signal` gets an operation-local SDK client
   * whose injected `fetch` applies that signal to the actual HTTP request (and
   * therefore to the response body read). The shared client's own `fetch` is
   * never touched, and unsignaled callers keep the plain `this.api` path.
   */
  async request<E extends keyof Endpoints, P extends RequestParams<E> = RequestParams<E>>(
    endpoint: E,
    params: StrictParams<E, P>,
    options?: { signal?: AbortSignal },
  ): Promise<RequestResponse<E, P>> {
    const signal = options?.signal;

    try {
      if (signal) {
        return await forwardRequest(this.signaledApi(signal), endpoint, params);
      }

      return await forwardRequest(this.api, endpoint, params);
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
   * An SDK client whose transport applies one abort signal to the request it
   * makes. Built per signaled call so no shared SDK state is mutated.
   */
  private signaledApi(signal: AbortSignal): MisskeyApi.APIClient {
    const signalFetch =
      ((input: string, init?: Parameters<MisskeyApi.FetchLike>[1]) =>
        fetch(input, { ...init, signal })) as MisskeyApi.FetchLike;

    return new MisskeyApi.APIClient({
      origin: this.origin,
      credential: this.config.token,
      fetch: signalFetch,
    });
  }

  /**
   * Get current user info (i.e., the bot's account info)
   */
  getSelf(): Promise<{
    id: string;
    username: string;
    name: string | null;
  }> {
    return this.request("i", {});
  }

  /**
   * Upload a file to Misskey Drive.
   *
   * The SDK's typed `drive/files/create` request builds the multipart body and
   * appends the credential itself; failures are classified by status through
   * `uploadFetch`.
   */
  async uploadFile(
    fileContent: Uint8Array,
    fileName: string,
  ): Promise<{ id: string; url: string }> {
    const result = await forwardRequest<"drive/files/create", RequestParams<"drive/files/create">>(
      this.uploadApi,
      "drive/files/create",
      // The copy narrows the view to a plain `ArrayBuffer`-backed buffer, which
      // is what `BlobPart` accepts.
      { name: fileName, file: new File([new Uint8Array(fileContent)], fileName) },
    );

    logger.info("File uploaded to Misskey Drive", {
      fileId: result.id,
      fileName,
    });

    return { id: result.id, url: result.url };
  }
}
