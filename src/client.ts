import {
  Configuration,
  V1AccountApi,
  V1AnalysisApi,
  V1ApiKeysApi,
  V1AuthApi,
  V1OrgApi,
  V1PoliciesApi,
  V1SessionsApi,
} from "../generated/src";

import { headerMiddleware, retryingFetch } from "./middleware";
import { paginate } from "./pagination";
import { RetryPolicy } from "./retry";

/** The production API. Pass `baseUrl` only to reach a different environment. */
export const DEFAULT_BASE_URL = "https://api.guardiano3.com";

export interface Guardiano3Options {
  /** An API key (`go3_live_...`) or a user access token. Both are sent the same
   *  way; the API tells them apart by the key prefix. */
  apiKey?: string;
  accessToken?: string;
  /** Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  retryPolicy?: RetryPolicy;
  fetchApi?: typeof fetch;
}

/**
 * A GuardianO3 API client.
 *
 * **Contains no business logic and makes no authorization decisions.** It is
 * transport, serialisation, authentication, models, errors, pagination and
 * retries. Anything it decided, an attacker could decide differently with curl,
 * so the rules live on the server.
 */
export class Guardiano3 {
  readonly auth: V1AuthApi;
  readonly sessions: V1SessionsApi;
  readonly account: V1AccountApi;
  readonly analysis: V1AnalysisApi;
  readonly apiKeys: V1ApiKeysApi;
  readonly policies: V1PoliciesApi;
  readonly org: V1OrgApi;

  constructor(options: Guardiano3Options = {}) {
    const credential = options.apiKey ?? options.accessToken;
    if (!credential) {
      throw new Error("No credential. Pass apiKey or accessToken.");
    }

    const configuration = new Configuration({
      basePath: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      accessToken: credential,
      middleware: [headerMiddleware()],
      fetchApi: retryingFetch(options.fetchApi ?? fetch, {
        retryPolicy: options.retryPolicy,
      }),
    });

    this.auth = new V1AuthApi(configuration);
    this.sessions = new V1SessionsApi(configuration);
    this.account = new V1AccountApi(configuration);
    this.analysis = new V1AnalysisApi(configuration);
    this.apiKeys = new V1ApiKeysApi(configuration);
    this.policies = new V1PoliciesApi(configuration);
    this.org = new V1OrgApi(configuration);
  }

  /** Every past session, newest first, across pages. Lazy. */
  iterHistory(options: { limit?: number; maxItems?: number } = {}) {
    return paginate(
      (cursor?: string) => this.sessions.listHistory({ cursor, limit: options.limit }),
      { maxItems: options.maxItems },
    );
  }
}
