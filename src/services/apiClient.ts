import { API_BASE_URL } from './env';

/**
 * Minimal JSON transport for the TaPago API.
 *
 * Deliberately thin — no axios, no interceptors, no retry policy. The app makes
 * a handful of calls and `fetch` is built in; a client library would be weight
 * without benefit at this size. Auth headers land here when a task needs them.
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
 * is "check your connection", the other is "the server said no".
 */
export class NetworkError extends Error {
  constructor(message = 'Unable to reach the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

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
 * POST a JSON body and parse the JSON reply.
 *
 * Throws `ApiError` for non-2xx replies and `NetworkError` when the request
 * could not complete at all (offline, DNS failure, timeout, malformed JSON).
 * A successful reply with an unparseable body is a `NetworkError` too — from
 * the caller's point of view the round trip failed either way.
 *
 * @param path Path beginning with `/`, appended to `API_BASE_URL`.
 * @param body Value serialised as the request body.
 * @param signal Optional caller-owned abort signal, combined with the timeout.
 */
export async function postJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
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

export default postJson;
