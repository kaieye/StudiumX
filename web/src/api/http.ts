/**
 * Authenticated HTTP client for the StudiumX Web app.
 *
 * Talks to StudiumX-Server (default http://localhost:3000). Access tokens are
 * read DIRECTLY from localStorage (`studiumx.accessToken`) - this module does
 * NOT import from `web/src/auth/*`, so the login flow and the HTTP client stay
 * decoupled and share only the localStorage contract (plan §6.2 / shared
 * convention).
 *
 * On HTTP 401 the client performs a single token refresh: POST /auth/refresh
 * with `studiumx.refreshToken` (rotation), persists the new access+refresh
 * pair, then retries the original request once. If the refresh fails or no
 * refresh token exists, both tokens are cleared and an `AuthError` is thrown.
 * Any other non-2xx response throws an `ApiError` carrying status + parsed body.
 *
 * Response/error shapes: see /tmp/studiumx-agents/server-contracts.md §0/§1.
 */

/** Base URL for StudiumX-Server; overridable via VITE_API_BASE_URL. */
export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

/** localStorage keys shared with the login flow (shared convention). */
const ACCESS_TOKEN_KEY = 'studiumx.accessToken'
const REFRESH_TOKEN_KEY = 'studiumx.refreshToken'

/** Query-string parameter values for `apiGet`. Null/undefined entries are skipped. */
export type ApiQuery = Record<string, string | number | boolean | null | undefined>

/** Shape of the server's `POST /auth/refresh` success body (rotation, §1). */
interface RefreshResponse {
  accessToken: string
  refreshToken: string
}

/**
 * Thrown when an authenticated request fails with a non-2xx status (after any
 * refresh retry is exhausted). Carries the HTTP status and the parsed response
 * body (the server's `{ error: { code, message } }` envelope, or raw text).
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? extractErrorMessage(status, body))
    this.name = 'ApiError'
    this.status = status
    this.body = body
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/**
 * Thrown when authentication cannot be established or recovered: no refresh
 * token, a failed refresh request, or a second 401 after a successful refresh.
 * Both localStorage tokens are cleared before this is thrown.
 */
export class AuthError extends Error {
  readonly code = 'AUTH_ERROR' as const

  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}

/** Pull the server's `error.message` out of the normalized envelope if present. */
function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return error.message
    }
  }
  return `Request failed with status ${status}`
}

function readToken(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // localStorage may be unavailable (private mode / sandbox); treat as absent.
    return null
  }
}

function writeToken(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore persistence failures; the in-flight request still proceeds */
  }
}

function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** Build the full URL, appending (and skipping null/undefined) query params. */
function buildUrl(path: string, query?: ApiQuery): string {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) {
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

/**
 * Perform one refresh attempt. Reads `studiumx.refreshToken`, POSTs
 * `/auth/refresh`, persists the rotated pair, and returns the new access token.
 * On any failure both tokens are cleared and an `AuthError` is thrown.
 */
async function doRefreshAccessToken(): Promise<string> {
  const refreshToken = readToken(REFRESH_TOKEN_KEY)
  if (!refreshToken) {
    clearTokens()
    throw new AuthError('No refresh token available; please sign in again.')
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken })
    })
  } catch (err) {
    clearTokens()
    throw new AuthError(`Token refresh request failed: ${(err as Error).message}`)
  }

  if (!res.ok) {
    clearTokens()
    throw new AuthError(`Token refresh rejected by server (status ${res.status}).`)
  }

  let data: RefreshResponse
  try {
    data = (await res.json()) as RefreshResponse
  } catch (err) {
    clearTokens()
    throw new AuthError(`Invalid token refresh response: ${(err as Error).message}`)
  }

  if (!data.accessToken || !data.refreshToken) {
    clearTokens()
    throw new AuthError('Token refresh response is missing access or refresh token.')
  }

  writeToken(ACCESS_TOKEN_KEY, data.accessToken)
  writeToken(REFRESH_TOKEN_KEY, data.refreshToken)
  return data.accessToken
}

/**
 * In-flight refresh singleton: concurrent 401s share one refresh so token
 * rotation (which revokes the old refresh token) is not stampeded.
 */
let refreshInFlight: Promise<string> | null = null

function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefreshAccessToken().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

type HttpMethod = 'GET' | 'POST' | 'PUT'

/**
 * Core request with automatic 401 -> refresh -> single retry. A second 401 or
 * an unrecoverable refresh throws `AuthError`; any other non-2xx throws
 * `ApiError`.
 */
async function request<T>(
  method: HttpMethod,
  path: string,
  query: ApiQuery | undefined,
  body: unknown,
  isRetry: boolean
): Promise<T> {
  const url = buildUrl(path, query)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const accessToken = readToken(ACCESS_TOKEN_KEY)
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch (err) {
    throw new ApiError(0, null, `Network request failed: ${(err as Error).message}`)
  }

  if (res.status === 401) {
    if (isRetry) {
      clearTokens()
      throw new AuthError('Authentication failed after token refresh.')
    }
    // Throws AuthError on failure; otherwise retries once with the fresh token.
    await refreshAccessToken()
    return request<T>(method, path, query, body, true)
  }

  const text = await res.text()
  let parsed: unknown = undefined
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed)
  }
  return parsed as T
}

/** Authenticated GET. `path` is relative to API_BASE (e.g. '/analytics/summary'). */
export function apiGet<T>(path: string, query?: ApiQuery): Promise<T> {
  return request<T>('GET', path, query, undefined, false)
}

/** Authenticated POST. `body` is JSON-encoded; omit for an empty body. */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, undefined, body, false)
}

/** Authenticated PUT. `body` is JSON-encoded; omit for an empty body. */
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, undefined, body, false)
}
