# GuardianO3 TypeScript SDK

> **Not published yet.** Version 0.1.0 is being prepared. `npm install @guardiano3/sdk`
> works once it is on npm.

The official TypeScript and JavaScript client for the
[GuardianO3](https://guardiano3.com) API: real-time fraud intelligence for phone
calls. Send a transcript, an audio clip or stream live audio, and get a risk decision
back.

You need an API key from the developer console at
[guardiano3.com](https://guardiano3.com).

## Install

```bash
npm install @guardiano3/sdk
```

Node 22+ and modern browsers. Typed throughout; no runtime dependencies.

## How this repository is laid out

| Directory | What it is |
|---|---|
| `src/` | **Hand-written**: the client, retries, idempotency, typed errors, pagination, live sessions |
| `generated/` | **Generated** from `openapi/v1.json` by `scripts/generate.sh`. Never edited by hand |
| `openapi/v1.json` | A copy of the GuardianO3 API contract, updated whenever the API changes |

Pull requests are welcome for the hand-written part; see
[CONTRIBUTING](https://github.com/guardiano3/.github/blob/main/CONTRIBUTING.md).
If generated code is wrong, open an issue: the fix belongs in the contract.

## A client

<!-- sample:typescript-client -->
```typescript
import { Guardiano3 } from "@guardiano3/sdk";

const client = new Guardiano3({ apiKey: process.env.GO3_API_KEY! });
```

| Option | Default | |
|---|---|---|
| `apiKey` | — | A `go3_live_…` / `go3_test_…` key |
| `accessToken` | — | A user access token, for personal-data endpoints |
| `baseUrl` | `https://api.guardiano3.com` | Set it only to reach a different environment |
| `retryPolicy` | `new RetryPolicy()` | See below |
| `fetchApi` | the platform `fetch` | Inject one for tests or a proxy |

Pass one credential or the other; both are sent as `Authorization: Bearer` and
the API tells them apart by the `go3_` prefix. With neither, the constructor
throws immediately rather than failing on the first call.

**Do not put an API key in a browser bundle.** Anything shipped to a browser is
public: a key there is a published credential with your quota attached. In a
web app the browser holds a short-lived *user access token* obtained by signing
in, and any machine credential stays on your server.

## Calling operations

Grouped by tag: `client.auth`, `client.sessions`, `client.account`,
`client.analysis`, `client.apiKeys`, `client.policies`, `client.org`. Method names come from the contract's
`operationId` — long, generated, stable, unambiguous.

<!-- sample:typescript-analyze -->
```typescript
import { Guardiano3 } from "@guardiano3/sdk";

const client = new Guardiano3({ apiKey: process.env.GO3_API_KEY! });

const result = await client.analysis.analyzeText({
  textAnalysisRequest: { text: "Share the OTP to unblock your account." },
});

console.log(result.riskLevel, result.riskScore); // 'high' 78.5
```

An audio clip is sent as a `Blob` (a browser `File` is one). WAV, MP3, FLAC,
OGG, M4A and WebM are accepted, up to 120 seconds:

<!-- sample:typescript-analyze-audio -->
```typescript
import { readFileSync } from "node:fs";

import { Guardiano3 } from "@guardiano3/sdk";

const client = new Guardiano3({ apiKey: process.env.GO3_API_KEY! });

const audio = new Blob([readFileSync("audio.m4a")], { type: "audio/mp4" });
const verdict = await client.analysis.analyzeAudio({ file: audio });

console.log(verdict.riskLevel, verdict.transcript);
```

Property names stay camelCase, matching the wire format exactly.

## Errors

<!-- sample:typescript-errors -->
```typescript
import {
  Guardiano3,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  ValidationError,
} from "@guardiano3/sdk";

const client = new Guardiano3({ apiKey: process.env.GO3_API_KEY! });

try {
  await client.sessions.getSession({ sessionId: "nope" });
} catch (error) {
  if (error instanceof QuotaExceededError) {
    throw error;                       // do not retry: waiting will not help
  } else if (error instanceof RateLimitError) {
    console.log("retry after", error.retryAfter);
  } else if (error instanceof NotFoundError) {
    // Also thrown when the row exists but belongs to someone else.
    console.log(error.code, error.statusCode, error.requestId);
  } else if (error instanceof ValidationError) {
    for (const detail of error.details) console.log(detail);
  } else {
    throw error;
  }
}
```

| Class | Status |
|---|---|
| `AuthenticationError` | 401 |
| `PermissionError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `ValidationError` | 422 |
| `RateLimitError` | 429 |
| `QuotaExceededError` | 429 with `QUOTA_EXCEEDED` — extends `RateLimitError`, so **order your `instanceof` checks narrowest first** |
| `ServerError` | 5xx |

All extend `APIError` (itself a `Guardiano3Error`) and carry `code`,
`statusCode`, `requestId`, `details` and `retryAfter`. An unrecognised code
falls back to the class for its HTTP status, so a new error code on the server
never breaks a deployed client.

`requestId` is baked into `error.message`, not only the property — otherwise it
never reaches a bug report.

## Retries

| | |
|---|---|
| Retried | 429, 502, 503, 504 |
| **Not** retried | 4xx other than 429, **500**, and any `QUOTA_EXCEEDED` |
| Attempts | 3 |
| Backoff | 0.5s, doubling, capped at 20s, ±25% jitter |
| `Retry-After` | Honoured when present |

Same policy as the Python SDK, deliberately: two SDKs that behave differently
under load produce two different incidents.

<!-- sample:typescript-retry-policy -->
```typescript
import { Guardiano3, RetryPolicy } from "@guardiano3/sdk";

const client = new Guardiano3({
  apiKey: process.env.GO3_API_KEY!,
  retryPolicy: new RetryPolicy({ maxAttempts: 5, initialBackoff: 1, maxBackoff: 30 }),
});
```

`new RetryPolicy({ maxAttempts: 1 })` disables retries.

## Idempotency

Every unsafe request carries an `Idempotency-Key`, generated once per logical
call and **outside** the retry loop, so a retry is a retry rather than a second
write. Set the header yourself to control it — the SDK does not overwrite one
you supply.

## Pagination

<!-- sample:typescript-pagination -->
```typescript
import { Guardiano3 } from "@guardiano3/sdk";

const client = new Guardiano3({ accessToken: process.env.GO3_ACCESS_TOKEN! });

for await (const session of client.iterHistory({ limit: 50, maxItems: 500 })) {
  console.log(session.id, session.riskLevel);
}
```

An async generator, and lazy: a page is fetched only when the previous one has
been consumed. `break` out of the loop and no further request is made. Cursors
are never your problem.

For any other paginated endpoint, `paginate` takes the page function directly:

<!-- sample:typescript-paginate -->
```typescript
import { Guardiano3, paginate } from "@guardiano3/sdk";

const client = new Guardiano3({ accessToken: process.env.GO3_ACCESS_TOKEN! });

for await (const item of paginate((cursor?: string) =>
  client.sessions.listHistory({ cursor }),
)) {
  console.log(item.id);
}
```

## WebSocket / Live Sessions

`LiveSession` manages the two WebSocket channels for real-time session
analysis: binary audio uplink and typed JSON decision downlink. It handles
authentication, frame parsing, and connection lifecycle.

<!-- sample:typescript-live -->
```typescript
import { readFile } from "node:fs/promises";

import { Guardiano3, LiveSession } from "@guardiano3/sdk";

const client = new Guardiano3({ apiKey: process.env.GO3_API_KEY! });

// 1. Create a session via REST
const session = await client.sessions.createSession({
  sessionCreateRequest: { phoneNumber: "+91 98765 43210", direction: "incoming" },
});

// 2. Open the live channels
const live = new LiveSession({
  baseUrl: "https://api.guardiano3.com",
  credential: process.env.GO3_API_KEY!,
  sessionId: session.id,

  onReady(frame) {
    console.log("Ready:", frame.sessionId);
  },
  onDecision(frame) {
    console.log(frame.riskLevel, frame.riskScore, frame.transcript);
  },
  onDecisionUpdate(frame) {
    console.log("Updated:", frame.riskLevel, frame.verificationStatus);
  },
  onLagging(frame) {
    console.warn("Dropped chunks:", frame.droppedChunks);
  },
  onError(frame) {
    console.error(frame.error.code, frame.error.message);
  },
  onDisconnect({ code, reason }) {
    console.log("Disconnected:", code, reason);
  },
});

live.connect();

// 3. Send PCM audio (16-bit LE, 16kHz mono). In a real client this is a chunk
//    off the microphone; here it comes from a file.
const pcmBuffer = await readFile("audio.raw");
live.sendAudio(pcmBuffer);

// 4. When done
live.close();
```

| Callback | Frame type | When |
|---|---|---|
| `onReady` | `ReadyFrame` | Session authenticated, audio accepted |
| `onDecision` | `DecisionFrame` | Scored chunk; `pending` verification means an update follows |
| `onDecisionUpdate` | `DecisionUpdateFrame` | Final decision for a chunk first sent as `pending`; replace it in place |
| `onLagging` | `LaggingFrame` | Audio arriving faster than transcription can process |
| `onDegraded` | `DegradedFrame` | Part of the audio was not analysed; no decision covers it. Not fatal: do not read a quiet stream as a safe session |
| `onError` | `ErrorFrame` | Fatal; server closes after sending |
| `onDisconnect` | — | Either WebSocket closed |

Both channels authenticate by sending `{"token": "..."}` as the first text
frame. Audio is sent as raw binary (PCM 16-bit LE, 16kHz mono). All
decision frames carry a `type` discriminator (`ready`, `decision`,
`decisionUpdate`, `degraded`, `lagging`, `error`, `ping`).

## Bundling and runtimes

- **Node 22+** (the maintained LTS releases) — uses the platform `fetch`; no
  polyfill needed.
- **Browsers** — works, but see the warning above about keys. Browser calls are
  subject to the API's CORS policy; to have your web origin allowed, contact
  support.
- **Edge runtimes** — the transport is `fetch` and `AbortController` only, so it
  runs where those do. Inject `fetchApi` if the runtime needs its own.
- **CommonJS and ESM** — the package is built as CommonJS with type
  declarations. ESM projects import it the same way
  (`import { Guardiano3 } from "@guardiano3/sdk"`) through Node's CommonJS
  interop, and bundlers handle it as usual.

## Testing against it

`fetchApi` is the injection point. Pass a stub and no network is touched — this
is how the SDK's own tests run, with no HTTP server and no mocking library.

## What it will never do

**No business logic, no authorization decisions.** Transport, serialisation,
authentication, models, errors, pagination and retries — nothing else. Anything
the SDK decided, an attacker could decide differently with `curl`, so the rules
live on the server.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The licence covers this SDK's source code. Using the GuardianO3 API requires an
API key and acceptance of the [Terms of Service](https://guardiano3.com/terms).

Security issues: see [SECURITY](https://github.com/guardiano3/.github/blob/main/SECURITY.md).
Never put API keys, session audio or transcripts in an issue.
