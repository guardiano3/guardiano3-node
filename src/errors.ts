/**
 * Typed errors, mapped from the API's published error codes.
 *
 * Two rules from the contract shape this file:
 *
 *  - **Unknown codes must not break the client.** New codes are added without a
 *    version bump, so an unrecognised one falls back to the class for its HTTP
 *    status. Throwing on a new code would make adding one a breaking change.
 *  - **`requestId` belongs in the message.** It is the one value support asks
 *    for; on a property alone, nobody pastes it into the report.
 */

export interface ErrorDetail {
  field?: string;
  issue?: string;
}

export class Guardiano3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Required for `instanceof` to work when compiled to ES5 targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class APIError extends Guardiano3Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details: ErrorDetail[];
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      requestId?: string;
      details?: ErrorDetail[];
      retryAfter?: number;
    } = {},
  ) {
    const suffix = [
      options.code ? `[${options.code}]` : "",
      options.requestId ? `(request ${options.requestId})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    super(suffix ? `${message} ${suffix}` : message);
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details ?? [];
    this.retryAfter = options.retryAfter;
  }
}

export class AuthenticationError extends APIError {}
export class PermissionError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class ValidationError extends APIError {}
export class RateLimitError extends APIError {}
/** Subclass of RateLimitError so `catch (RateLimitError)` still applies, but
 *  distinct: waiting seconds does not clear a daily allowance. */
export class QuotaExceededError extends RateLimitError {}
export class ServerError extends APIError {}

type ErrorConstructor = new (message: string, options?: ConstructorParameters<typeof APIError>[1]) => APIError;

const BY_CODE: Record<string, ErrorConstructor> = {
  UNAUTHENTICATED: AuthenticationError,
  INVALID_CREDENTIALS: AuthenticationError,
  INVALID_TOKEN: AuthenticationError,
  TOKEN_REVOKED: AuthenticationError,
  INVALID_REFRESH_TOKEN: AuthenticationError,
  REFRESH_TOKEN_REUSED: AuthenticationError,
  INVALID_API_KEY: AuthenticationError,
  REAUTHENTICATION_REQUIRED: AuthenticationError,
  MFA_REQUIRED: AuthenticationError,
  FORBIDDEN: PermissionError,
  INSUFFICIENT_SCOPE: PermissionError,
  EMAIL_NOT_VERIFIED: PermissionError,
  ACCOUNT_SUSPENDED: PermissionError,
  WRONG_ENVIRONMENT: PermissionError,
  NOT_FOUND: NotFoundError,
  ALREADY_EXISTS: ConflictError,
  CONFLICT: ConflictError,
  IDEMPOTENCY_KEY_REUSED: ConflictError,
  VALIDATION_ERROR: ValidationError,
  INVALID_REQUEST: ValidationError,
  PASSWORD_POLICY_VIOLATION: ValidationError,
  BREACHED_PASSWORD: ValidationError,
  UNSUPPORTED_MEDIA_TYPE: ValidationError,
  PAYLOAD_TOO_LARGE: ValidationError,
  RATE_LIMITED: RateLimitError,
  QUOTA_EXCEEDED: QuotaExceededError,
  CONCURRENCY_LIMIT: RateLimitError,
  INTERNAL_ERROR: ServerError,
  SERVICE_UNAVAILABLE: ServerError,
  UPSTREAM_ERROR: ServerError,
  UPSTREAM_TIMEOUT: ServerError,
  NOT_CONFIGURED: ServerError,
};

const BY_STATUS: Record<number, ErrorConstructor> = {
  400: ValidationError,
  401: AuthenticationError,
  403: PermissionError,
  404: NotFoundError,
  409: ConflictError,
  413: ValidationError,
  415: ValidationError,
  422: ValidationError,
  429: RateLimitError,
};

export function errorClass(statusCode: number, code?: string): ErrorConstructor {
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (BY_STATUS[statusCode]) return BY_STATUS[statusCode];
  return statusCode >= 500 ? ServerError : APIError;
}

function asNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Build a typed error from an API error response body. */
export function fromResponse(
  statusCode: number,
  body: unknown,
  headers?: { get(name: string): string | null },
): APIError {
  const envelope =
    body && typeof body === "object" ? (body as Record<string, unknown>)["error"] : undefined;

  let code: string | undefined;
  let message: string;
  let requestId: string | undefined;
  let details: ErrorDetail[] | undefined;

  if (envelope && typeof envelope === "object") {
    const e = envelope as Record<string, unknown>;
    code = typeof e.code === "string" ? e.code : undefined;
    message = typeof e.message === "string" ? e.message : "Request failed.";
    requestId = typeof e.requestId === "string" ? e.requestId : undefined;
    details = Array.isArray(e.details) ? (e.details as ErrorDetail[]) : undefined;
  } else {
    // A legacy route, or an intermediary that answered instead of the API.
    // Salvage what we can rather than pretending it was well-formed.
    const detail =
      body && typeof body === "object" ? (body as Record<string, unknown>)["detail"] : undefined;
    message = typeof detail === "string" ? detail : `Request failed with status ${statusCode}.`;
  }

  requestId = requestId ?? headers?.get("x-request-id") ?? undefined;
  const Cls = errorClass(statusCode, code);
  return new Cls(message, {
    statusCode,
    code,
    requestId,
    details,
    retryAfter: asNumber(headers?.get("retry-after")),
  });
}
