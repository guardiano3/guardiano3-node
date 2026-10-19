/**
 * The TypeScript SDK's hand-written core.
 *
 * The generated layer is not tested here -- testing generated code tests the
 * generator. What is tested is the half we wrote, which is where the behaviour
 * a caller depends on lives.
 *
 * Uses Node's built-in test runner, so verifying the SDK needs no extra
 * dependency beyond TypeScript itself.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  APIError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ValidationError,
  errorClass,
  fromResponse,
} from "../src/errors";
import { DEFAULT_BASE_URL, Guardiano3 } from "../src/client";
import { headerMiddleware, retryingFetch } from "../src/middleware";
import { paginate } from "../src/pagination";
import { RetryPolicy } from "../src/retry";

// --- error mapping ---------------------------------------------------------

test("published codes map to typed errors", () => {
  const cases: Array<[string, Function]> = [
    ["INVALID_API_KEY", AuthenticationError],
    ["INSUFFICIENT_SCOPE", PermissionError],
    ["NOT_FOUND", NotFoundError],
    ["IDEMPOTENCY_KEY_REUSED", ConflictError],
    ["VALIDATION_ERROR", ValidationError],
    ["RATE_LIMITED", RateLimitError],
    ["QUOTA_EXCEEDED", QuotaExceededError],
    ["INTERNAL_ERROR", ServerError],
  ];
  for (const [code, cls] of cases) {
    assert.equal(errorClass(400, code), cls, code);
  }
});

test("an unknown code falls back to the status class", () => {
  // New codes ship without a version bump; throwing on one would make adding
  // an error code a breaking change.
  const error = fromResponse(403, { error: { code: "SOME_FUTURE_CODE", message: "x" } });
  assert.ok(error instanceof PermissionError);
  assert.equal(error.code, "SOME_FUTURE_CODE");
});

test("a quota error is still a rate limit error", () => {
  const error = fromResponse(429, { error: { code: "QUOTA_EXCEEDED", message: "x" } });
  assert.ok(error instanceof RateLimitError);
  assert.ok(error instanceof QuotaExceededError);
});

test("the request id is in the message", () => {
  const error = fromResponse(404, {
    error: { code: "NOT_FOUND", message: "No such session.", requestId: "req_abc" },
  });
  assert.match(error.message, /req_abc/);
  assert.equal(error.requestId, "req_abc");
});

test("instanceof survives compilation", () => {
  // Without setPrototypeOf in the base class this fails on ES5-ish targets and
  // every `catch (e instanceof ...)` in caller code silently stops matching.
  const error = fromResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  assert.ok(error instanceof NotFoundError);
  assert.ok(error instanceof APIError);
  assert.ok(error instanceof Error);
});

test("a legacy detail body is still usable", () => {
  const error = fromResponse(401, { detail: "Not authenticated" });
  assert.ok(error instanceof AuthenticationError);
  assert.equal(error.message.startsWith("Not authenticated"), true);
});

test("a non-JSON body does not crash the client", () => {
  const error = fromResponse(502, undefined);
  assert.ok(error instanceof ServerError);
  assert.match(error.message, /502/);
});

// --- retry policy ----------------------------------------------------------

test("transient failures are retried and permanent ones are not", () => {
  const policy = new RetryPolicy();
  for (const status of [429, 502, 503, 504]) {
    assert.equal(policy.shouldRetry(1, status), true, String(status));
  }
  for (const status of [400, 401, 403, 404, 409, 422, 500]) {
    assert.equal(policy.shouldRetry(1, status), false, String(status));
  }
});

test("a quota failure is never retried", () => {
  assert.equal(new RetryPolicy().shouldRetry(1, 429, "QUOTA_EXCEEDED"), false);
});

test("backoff grows and is capped", () => {
  const policy = new RetryPolicy({ initialBackoff: 1, multiplier: 2, maxBackoff: 5, jitter: 0 });
  assert.deepEqual([1, 2, 3, 4].map((a) => policy.backoff(a)), [1, 2, 4, 5]);
});

test("backoff is jittered", () => {
  const policy = new RetryPolicy({ initialBackoff: 1, jitter: 0.25 });
  const delays = new Set(Array.from({ length: 50 }, () => policy.backoff(1)));
  assert.ok(delays.size > 1, "identical delays would re-create the overload");
});

test("the server's Retry-After beats our guess, but is still capped", () => {
  const policy = new RetryPolicy({ maxBackoff: 20 });
  assert.equal(policy.backoff(1, 9), 9);
  assert.equal(policy.backoff(1, 3600), 20);
});

// --- transport -------------------------------------------------------------

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("the idempotency key is reused across retries", async () => {
  // The property this layer exists for. A key regenerated on retry makes the
  // server do the work twice -- the exact failure it prevents.
  const seen: string[] = [];
  let attempt = 0;

  const underlying = (async (_input: any, init: any) => {
    seen.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
    attempt += 1;
    return attempt < 3
      ? jsonResponse(429, { error: { code: "RATE_LIMITED", message: "slow" } })
      : jsonResponse(201, { id: "sess-1" });
  }) as unknown as typeof fetch;

  const wrapped = retryingFetch(underlying, {
    retryPolicy: new RetryPolicy({ maxAttempts: 5 }),
    sleep: async () => {},
  });

  const middleware = headerMiddleware();
  const prepared = await middleware.pre({ url: "http://api/v1/sessions", init: { method: "POST" } });
  await wrapped("http://api/v1/sessions" as any, prepared.init as any);

  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 1, `the key changed between retries: ${seen}`);
  assert.ok(seen[0].length > 0);
});

test("safe methods get no idempotency key", async () => {
  const prepared = await headerMiddleware().pre({
    url: "http://api/v1/history",
    init: { method: "GET" },
  });
  assert.equal(new Headers(prepared.init.headers).has("Idempotency-Key"), false);
});

test("audio uploads get no idempotency key", async () => {
  const prepared = await headerMiddleware().pre({
    url: "http://api/v1/analyze/audio",
    init: { method: "POST" },
  });
  assert.equal(new Headers(prepared.init.headers).has("Idempotency-Key"), false);
});

test("every request carries a request id", async () => {
  const prepared = await headerMiddleware().pre({
    url: "http://api/v1/history",
    init: { method: "GET" },
  });
  assert.ok(new Headers(prepared.init.headers).get("X-Request-Id"));
});

test("an error response becomes a typed exception", async () => {
  const middleware = headerMiddleware();
  await assert.rejects(
    () =>
      middleware.post({
        response: jsonResponse(404, {
          error: { code: "NOT_FOUND", message: "gone", requestId: "req_1" },
        }),
      }),
    (error: unknown) => error instanceof NotFoundError && (error as APIError).requestId === "req_1",
  );
});

test("a permanent failure is not retried", async () => {
  let calls = 0;
  const underlying = (async () => {
    calls += 1;
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "gone" } });
  }) as unknown as typeof fetch;

  await retryingFetch(underlying, { sleep: async () => {} })("http://api/x" as any, {} as any);
  assert.equal(calls, 1);
});

test("the server's Retry-After is honoured between attempts", async () => {
  const slept: number[] = [];
  let calls = 0;
  const underlying = (async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse(429, { error: { code: "RATE_LIMITED", message: "x" } }, { "retry-after": "4" })
      : jsonResponse(200, {});
  }) as unknown as typeof fetch;

  await retryingFetch(underlying, { sleep: async (s) => { slept.push(s); } })(
    "http://api/x" as any,
    {} as any,
  );
  assert.deepEqual(slept, [4]);
});

// --- pagination ------------------------------------------------------------

test("pages are flattened in order", async () => {
  const pages: Record<string, any> = {
    "": { items: [1, 2], nextCursor: "c1" },
    c1: { items: [3], nextCursor: null },
  };
  const out: number[] = [];
  for await (const item of paginate<number>(async (c) => pages[c ?? ""])) out.push(item);
  assert.deepEqual(out, [1, 2, 3]);
});

test("iteration is lazy", async () => {
  let calls = 0;
  const iterator = paginate<number>(async () => {
    calls += 1;
    return { items: [1, 2], nextCursor: "next" };
  });
  await iterator.next();
  assert.equal(calls, 1, "one page, not the whole history");
});

test("maxItems stops early", async () => {
  const pages: Record<string, any> = {
    "": { items: [1, 2], nextCursor: "c1" },
    c1: { items: [3, 4], nextCursor: "c2" },
  };
  const out: number[] = [];
  for await (const item of paginate<number>(async (c) => pages[c ?? ""], { maxItems: 3 })) {
    out.push(item);
  }
  assert.deepEqual(out, [1, 2, 3]);
});

test("a page claiming more but giving no cursor terminates", async () => {
  // Otherwise a server bug becomes an infinite loop in every client.
  const out: number[] = [];
  for await (const item of paginate<number>(async () => ({ items: [1], hasMore: true }))) {
    out.push(item);
  }
  assert.deepEqual(out, [1]);
});

test("the default base URL is production, and baseUrl overrides it", async () => {
  const seen: string[] = [];
  const stub = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "x" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  for (const [options, expected] of [
    [{}, "https://api.guardiano3.com/v1/whoami"],
    [{ baseUrl: "http://localhost:8000/" }, "http://localhost:8000/v1/whoami"],
  ] as const) {
    const client = new Guardiano3({ apiKey: "go3_test_x", fetchApi: stub, ...options });
    await assert.rejects(client.apiKeys.whoami());
    assert.equal(seen.pop(), expected);
  }
  assert.equal(DEFAULT_BASE_URL, "https://api.guardiano3.com");
});
