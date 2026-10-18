/**
 * GuardianO3 TypeScript SDK.
 *
 * Generated models and operations from the published OpenAPI contract, over a
 * hand-written transport adding retries with jitter, idempotency keys,
 * request-id propagation, cursor pagination and typed errors.
 *
 * ```ts
 * import { Guardiano3, RateLimitError } from "@guardiano3/sdk";
 *
 * const client = new Guardiano3({ apiKey: "go3_live_..." });
 * try {
 *   for await (const session of client.iterHistory({ limit: 50 })) {
 *     console.log(session.id, session.riskLevel);
 *   }
 * } catch (e) {
 *   if (e instanceof RateLimitError) console.log("slow down", e.retryAfter, e.requestId);
 * }
 * ```
 *
 * Never edit `generated/` -- it is rebuilt from the contract by
 * `scripts/generate.sh`.
 */

export * from "./errors";
export * from "./retry";
export * from "./pagination";
export { headerMiddleware, retryingFetch } from "./middleware";
export { DEFAULT_BASE_URL, Guardiano3 } from "./client";
export type { Guardiano3Options } from "./client";
export { LiveSession } from "./live";
export type { LiveSessionOptions } from "./live";
