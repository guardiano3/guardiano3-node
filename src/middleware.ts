/**
 * Transport behaviour, as generated-client middleware.
 *
 * One property here is load-bearing and easy to get wrong:
 *
 *   **The Idempotency-Key is generated once per logical request and reused for
 *   every retry of it.**
 *
 * A key regenerated on retry defeats the mechanism entirely -- the server sees
 * two unrelated requests and does the work twice, which is the exact failure
 * idempotency keys exist to prevent. It is worse than not retrying, because it
 * looks like it is working.
 */

import { APIError, fromResponse } from "./errors";
import { RetryPolicy } from "./retry";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH"]);
/** The API does not accept the header here: fingerprinting a large upload would
 *  double its memory cost. */
const NO_IDEMPOTENCY_PATHS = ["/v1/analyze/audio"];

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Node without webcrypto, or an old browser. Only needs to be unique, not
  // unguessable: the key is a de-duplication token, not a credential.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

export interface TransportOptions {
  retryPolicy?: RetryPolicy;
  sleep?: (seconds: number) => Promise<void>;
}

const defaultSleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Adds request ids and idempotency keys on the way out, and turns error
 * responses into typed exceptions on the way back.
 *
 * Retries live in {@link retryingFetch} rather than here: the generated
 * middleware `post` hook cannot re-issue a request, so retrying has to wrap
 * fetch itself.
 */
export function headerMiddleware() {
  return {
    async pre(context: { url: string; init: RequestInit }) {
      const headers = new Headers(context.init.headers);
      const method = (context.init.method ?? "GET").toUpperCase();

      if (!headers.has("X-Request-Id")) headers.set("X-Request-Id", `cli_${uuid()}`);

      if (
        UNSAFE_METHODS.has(method) &&
        !headers.has("Idempotency-Key") &&
        !NO_IDEMPOTENCY_PATHS.some((p) => context.url.includes(p))
      ) {
        headers.set("Idempotency-Key", uuid());
      }

      return { url: context.url, init: { ...context.init, headers } };
    },

    async post(context: { response: Response }) {
      const response = context.response;
      if (response.ok) return response;
      const body = await readBody(response);
      throw fromResponse(response.status, body, response.headers);
    },
  };
}

/**
 * A `fetch` wrapper that retries transient failures.
 *
 * The same Request is re-issued, so the headers set by {@link headerMiddleware}
 * -- including the idempotency key -- are carried unchanged into every attempt.
 */
export function retryingFetch(
  underlying: typeof fetch,
  options: TransportOptions = {},
): typeof fetch {
  const policy = options.retryPolicy ?? new RetryPolicy();
  const sleep = options.sleep ?? defaultSleep;

  return async function retrying(input: any, init?: any): Promise<Response> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const response = await underlying(input, init);
      if (response.ok) return response;

      let code: string | undefined;
      const body = await readBody(response);
      if (body && typeof body === "object") {
        const envelope = (body as Record<string, unknown>)["error"];
        if (envelope && typeof envelope === "object") {
          const c = (envelope as Record<string, unknown>)["code"];
          if (typeof c === "string") code = c;
        }
      }

      if (!policy.shouldRetry(attempt, response.status, code)) return response;

      const header = response.headers.get("retry-after");
      const retryAfter = header !== null && Number.isFinite(Number(header)) ? Number(header) : undefined;
      await sleep(policy.backoff(attempt, retryAfter));
    }
  } as typeof fetch;
}

export { APIError };
