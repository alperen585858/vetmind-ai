import {
  getBackendAccessToken,
  getBackendRefreshToken,
  loadSession,
  setBackendAccessToken,
  setBackendTokens,
} from '../auth/session'

export const API_BASE = '/api/v1'

export class BackendUnavailableError extends Error {
  // Shown to users; the developer hint (start the backend) lives in README §4.
  // Prefer presentApiError() / auth.backendUnreachable for locale-aware UI.
  constructor(message = 'Sunucuya ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.') {
    super(message)
    this.name = 'BackendUnavailableError'
  }
}

/** HTTP API failure with optional stable ``code`` for i18n. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly params?: Record<string, string | number>
  readonly detail: unknown

  constructor(opts: {
    status: number
    message: string
    code?: string
    params?: Record<string, string | number>
    detail?: unknown
  }) {
    super(opts.message)
    this.name = 'ApiError'
    this.status = opts.status
    this.code = opts.code
    this.params = opts.params
    this.detail = opts.detail
  }
}

/**
 * Frontend stopped polling (unmount / navigation / user cancel).
 * Does NOT cancel the backend AnalysisJob — the worker may still finish.
 */
export class PollingCancelledError extends Error {
  readonly jobId?: string
  constructor(message = 'Job polling cancelled by client', jobId?: string) {
    super(message)
    this.name = 'PollingCancelledError'
    this.jobId = jobId
  }
}

export function throwIfAborted(signal: AbortSignal | undefined, jobId?: string): void {
  if (signal?.aborted) {
    throw new PollingCancelledError('Job polling cancelled by client', jobId)
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PollingCancelledError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PollingCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  try {
    return JSON.stringify(detail)
  } catch {
    return 'Request failed'
  }
}

export function parseApiDetail(detail: unknown): {
  message: string
  code?: string
  params?: Record<string, string | number>
} {
  if (typeof detail === 'string') {
    return { message: detail }
  }
  // FastAPI 422 validation: detail is [{ loc, msg, type }, ...]
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return formatDetail(item)
        const row = item as Record<string, unknown>
        if (typeof row.msg === 'string') return row.msg
        if (typeof row.message === 'string') return row.message
        return formatDetail(item)
      })
      .filter(Boolean)
    return {
      message: msgs.length ? msgs.join('; ') : 'Validation failed',
      code: 'validation_error',
      params: msgs.length > 1 ? { count: msgs.length } : undefined,
    }
  }
  if (detail && typeof detail === 'object') {
    const obj = detail as Record<string, unknown>
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : formatDetail(detail)
    const code = typeof obj.code === 'string' ? obj.code : undefined
    const params: Record<string, string | number> = {}
    for (const key of ['minutes', 'min', 'max', 'count'] as const) {
      const v = obj[key]
      if (typeof v === 'number' || typeof v === 'string') params[key] = v
    }
    return {
      message,
      code,
      params: Object.keys(params).length ? params : undefined,
    }
  }
  return { message: formatDetail(detail) }
}

/** Fired on `window` when the backend session cannot be renewed (user must sign in again). */
export const AUTH_EXPIRED_EVENT = 'vetmind:auth-expired'

let refreshInFlight: Promise<boolean> | null = null

function endBackendSession() {
  setBackendAccessToken(null)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/**
 * Exchange the stored refresh token for a new token pair. Concurrent callers in this tab
 * share one request: refresh tokens are single-use, so two parallel refreshes would look
 * like reuse. Other tabs share localStorage, so a refusal is checked against storage first.
 * Returns false when the session cannot be renewed (tokens are then cleared and
 * AUTH_EXPIRED_EVENT fires) or on a network error (tokens are kept).
 */
export function refreshBackendSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  const refreshToken = getBackendRefreshToken()
  if (!refreshToken) {
    // Signed in before refresh tokens existed (or storage was cleared): nothing can renew it.
    endBackendSession()
    return Promise.resolve(false)
  }
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) {
        // Another tab rotated the token meanwhile and stored the new pair: use that.
        const current = getBackendRefreshToken()
        if (current && current !== refreshToken) return true
        endBackendSession()
        return false
      }
      let pair: { access_token: string; refresh_token: string }
      try {
        pair = (await res.json()) as { access_token: string; refresh_token: string }
      } catch {
        return false
      }
      if (!pair?.access_token || !pair?.refresh_token) return false
      setBackendTokens(pair)
      return true
    } catch {
      // Network error: keep the tokens, the next request can try again.
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

function applySessionDemoHeaders(headers: Headers): void {
  // Never send demo attribution alongside a JWT — backend ignores it when auth is on,
  // but the client must not imply a different actor than Authorization.
  if (getBackendAccessToken()) return
  const session = loadSession()
  if (session?.role && session?.email) {
    if (!headers.has('X-VetMind-Demo-Role')) headers.set('X-VetMind-Demo-Role', session.role)
    if (!headers.has('X-VetMind-Demo-Subject')) headers.set('X-VetMind-Demo-Subject', session.email)
  }
}

/** Authenticated fetch with one 401→refresh→retry (for binary/PDF/DICOM paths that skip request()). */
export async function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
  let sentToken: string | null = null
  const send = async (): Promise<Response> => {
    const headers = new Headers(init?.headers)
    const token = getBackendAccessToken()
    sentToken = null
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
      sentToken = token
    }
    applySessionDemoHeaders(headers)
    try {
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      return await fetch(`${API_BASE}${path}`, { ...init, headers })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'AbortError') throw err
      throw new BackendUnavailableError()
    }
  }

  let res = await send()
  const canRefresh =
    res.status === 401 && !path.startsWith('/auth/') && (Boolean(sentToken) || Boolean(getBackendRefreshToken()))
  if (canRefresh) {
    const current = getBackendAccessToken()
    if (sentToken && current && current !== sentToken) {
      res = await send()
    } else if (await refreshBackendSession()) {
      res = await send()
    }
  }
  return res
}

export async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return
  let rawDetail: unknown = res.statusText
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (body.detail !== undefined) rawDetail = body.detail
  } catch {
    try {
      const text = await res.text()
      if (text) rawDetail = text
    } catch {
      /* ignore */
    }
  }
  const parsed = parseApiDetail(rawDetail)
  throw new ApiError({
    status: res.status,
    message: parsed.message || res.statusText || fallback,
    code: parsed.code,
    params: parsed.params,
    detail: rawDetail,
  })
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  let sentToken: string | null = null

  const send = async (): Promise<Response> => {
    const headers = new Headers(init?.headers)
    if (!isForm && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const token = getBackendAccessToken()
    sentToken = null
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
      sentToken = token
    }
    // When auth is disabled, attribute support messages to the active demo session.
    applySessionDemoHeaders(headers)
    try {
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      return await fetch(`${API_BASE}${path}`, { ...init, headers })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'AbortError') throw err
      throw new BackendUnavailableError()
    }
  }

  let res = await send()
  // Expired / missing access token: renew once with the refresh token and retry.
  const canRefresh =
    res.status === 401 &&
    !path.startsWith('/auth/') &&
    (Boolean(sentToken) || Boolean(getBackendRefreshToken()))
  if (canRefresh) {
    const current = getBackendAccessToken()
    if (sentToken && current && current !== sentToken) {
      // Renewed meanwhile (another request or tab): just retry with the newer token.
      res = await send()
    } else if (await refreshBackendSession()) {
      res = await send()
    }
  }
  if (!res.ok) {
    let rawDetail: unknown = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body.detail !== undefined) rawDetail = body.detail
    } catch {
      /* ignore */
    }
    const parsed = parseApiDetail(rawDetail)
    throw new ApiError({
      status: res.status,
      message: parsed.message || res.statusText || 'Request failed',
      code: parsed.code,
      params: parsed.params,
      detail: rawDetail,
    })
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError({
      status: res.status,
      message: 'Invalid JSON response from server',
      detail: text.slice(0, 200),
    })
  }
}
