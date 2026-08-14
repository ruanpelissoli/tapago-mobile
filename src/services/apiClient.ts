import { API_BASE_URL } from './env';

/**
 * Minimal JSON transport for the TaPago API.
 *
 * Deliberately thin — no axios, no interceptors, no retry policy. The app makes
 * a handful of calls and `fetch` is built in; a client library would be weight
 * without benefit at this size.
 *
 * The `Authorization` header is attached *here*, from a token getter that
 * `AuthProvider` registers, so no call site ever threads a JWT around.
 */

/** How long a request may take before it is aborted, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A non-2xx response from the API.
 *
 * `status` is the HTTP code and `code` is the machine-readable string from the
 * body's `error` field when the API sent one. Callers map these to user-facing
 * copy; this layer never invents display text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message?: string) {
    super(message ?? code ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The request never reached the API, or the reply was unreadable.
 *
 * Kept distinct from `ApiError` because the two want different user copy: one
 * is "check your connection", the other is "the server said no". `status` is
 * `0` — no HTTP exchange completed — so that *every* error thrown from a
 * service uniformly carries `status` and `message`, and a caller that only
 * wants to log can do so without narrowing first.
 */
export class NetworkError extends Error {
  readonly status = 0;

  constructor(message = 'Unable to reach the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Anything a service in this directory throws.
 *
 * Deliberately a union rather than a base class: making `NetworkError` extend
 * `ApiError` would make every `instanceof ApiError` check (there are several,
 * driving user copy by status) silently start matching offline failures.
 */
export type ApiFailure = ApiError | NetworkError;

/** Reads the current session JWT, or `null` when signed out. */
export type AuthTokenProvider = () => string | null;

let authTokenProvider: AuthTokenProvider | null = null;

/**
 * Register (or clear, with `null`) the source of the session JWT.
 *
 * `useAuth` is a React hook and this is a plain module, so the token cannot be
 * read directly — the provider pushes a getter in instead. It must be a getter
 * rather than a value: the token changes on sign-in, sign-out and cold-start
 * restore, and a captured string would go stale on all three.
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

/** Per-request options shared by every verb. */
export type RequestOptions = {
  /** Caller-owned cancellation, combined with the timeout. */
  signal?: AbortSignal;
  /** Attach `Authorization: Bearer <token>`. Defaults to `false`. */
  auth?: boolean;
  /** Override the default timeout for a slow endpoint. */
  timeoutMs?: number;
};

/** Pull the API's `{ "error": "..." }` string out of a response body. */
function readErrorCode(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Build the request headers, including auth when asked for.
 *
 * @throws {ApiError} 401 when auth is required but no token is available.
 */
function buildHeaders(hasBody: boolean, auth: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = authTokenProvider?.() ?? null;
    if (token === null || token.length === 0) {
      // Fail before the round trip. Calling an authenticated endpoint while
      // signed out is a wiring bug (a screen rendered outside the auth guard),
      // and spending a user's network time to be told 401 helps nobody.
      throw new ApiError(401, 'not_authenticated');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Perform a JSON request and parse the JSON reply.
 *
 * Throws `ApiError` for non-2xx replies and `NetworkError` when the request
 * could not complete at all (offline, DNS failure, timeout, malformed JSON).
 * A successful reply with an unparseable body is a `NetworkError` too — from
 * the caller's point of view the round trip failed either way.
 */
async function requestJson<TResponse>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { signal, auth = false, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const hasBody = method !== 'GET';

  // Before any timer or controller is created, so a missing token cannot leak
  // a pending timeout.
  const headers = buildHeaders(hasBody, auth);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Forward an already-aborted or later-aborted caller signal onto our own
  // controller, so a screen unmounting mid-request cancels the fetch.
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortFromCaller);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // fetch rejects for offline, DNS failure, TLS problems and aborts alike.
    throw new NetworkError();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  // 204 and empty bodies parse as null, which is fine for callers expecting void.
  let parsed: unknown = null;
  const raw = await response.text().catch(() => '');
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (response.ok) {
        throw new NetworkError('Received a malformed response from the server');
      }
      // A non-JSON error body (an HTML 502 page, say) still carries its status.
      throw new ApiError(response.status, null);
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, readErrorCode(parsed));
  }

  return parsed as TResponse;
}

/**
 * POST a JSON body and parse the JSON reply.
 *
 * @param path Path beginning with `/`, appended to `API_BASE_URL`.
 * @param body Value serialised as the request body.
 * @param signalOrOptions Legacy positional `AbortSignal`, or `RequestOptions`.
 */
export async function postJson<TResponse>(
  path: string,
  body: unknown,
  signalOrOptions?: AbortSignal | RequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>('POST', path, body, toOptions(signalOrOptions));
}

/**
 * GET a path and parse the JSON reply.
 *
 * @param path Path beginning with `/`, appended to `API_BASE_URL`.
 * @param signalOrOptions Positional `AbortSignal`, or `RequestOptions`.
 */
export async function getJson<TResponse>(
  path: string,
  signalOrOptions?: AbortSignal | RequestOptions,
): Promise<TResponse> {
  return requestJson<TResponse>('GET', path, undefined, toOptions(signalOrOptions));
}

/**
 * Accept either a bare `AbortSignal` (the original call shape, still used by
 * `authService`) or the fuller options object.
 *
 * The check is structural rather than `instanceof AbortSignal`: the global
 * constructor is a runtime polyfill on React Native, and duck-typing keeps this
 * working under a test double that isn't a real `AbortSignal`.
 */
function toOptions(value: AbortSignal | RequestOptions | undefined): RequestOptions {
  if (value === undefined) return {};
  if (typeof (value as AbortSignal).aborted === 'boolean') {
    return { signal: value as AbortSignal };
  }
  return value as RequestOptions;
}

export default postJson;
