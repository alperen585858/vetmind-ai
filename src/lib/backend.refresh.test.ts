import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendAccessToken, getBackendRefreshToken, setBackendTokens } from './auth'
import { AUTH_EXPIRED_EVENT, backendLogout, listBackendCases, refreshBackendSession } from './backend'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('backend session refresh (issue #31 step 3)', () => {
  let events: string[]

  beforeEach(() => {
    events = []
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => events.push(e.type) })
    setBackendTokens({ access_token: 'old-access', refresh_token: 'refresh-1' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renews an expired access token once and retries the request', async () => {
    const authHeaders: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-1' })
        return json({ access_token: 'new-access', refresh_token: 'refresh-2' })
      }
      const auth = new Headers(init?.headers).get('Authorization') ?? ''
      authHeaders.push(auth)
      return auth === 'Bearer new-access' ? json([]) : json({ detail: 'Invalid or expired credentials.' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listBackendCases()).resolves.toEqual([])
    expect(authHeaders).toEqual(['Bearer old-access', 'Bearer new-access'])
    expect(getBackendAccessToken()).toBe('new-access')
    expect(getBackendRefreshToken()).toBe('refresh-2')
    expect(events).toEqual([])
  })

  it('clears tokens and fires the expired event when the refresh is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/auth/refresh')
          ? json({ detail: 'Session expired. Please sign in again.' }, 401)
          : json({ detail: 'Invalid or expired credentials.' }, 401),
      ),
    )

    await expect(listBackendCases()).rejects.toThrow('Invalid or expired credentials.')
    expect(getBackendAccessToken()).toBeNull()
    expect(getBackendRefreshToken()).toBeNull()
    expect(events).toEqual([AUTH_EXPIRED_EVENT])
  })

  it('shares one refresh between concurrent callers (refresh tokens are single-use)', async () => {
    let refreshCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) {
          refreshCalls += 1
          await new Promise((r) => setTimeout(r, 5))
          return json({ access_token: 'new-access', refresh_token: 'refresh-2' })
        }
        return json([])
      }),
    )

    const results = await Promise.all([refreshBackendSession(), refreshBackendSession(), refreshBackendSession()])
    expect(results).toEqual([true, true, true])
    expect(refreshCalls).toBe(1)
  })

  it('keeps tokens on a network error so a later request can retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(refreshBackendSession()).resolves.toBe(false)
    expect(getBackendRefreshToken()).toBe('refresh-1')
    expect(events).toEqual([])
  })

  it('does not try to refresh when no refresh token is stored', async () => {
    setBackendTokens({ access_token: 'only-access', refresh_token: null })
    const fetchMock = vi.fn(async () => json({ detail: 'nope' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listBackendCases()).rejects.toThrow('nope')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('logout revokes the stored refresh token on the backend', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await backendLogout()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/v1/auth/logout')
    expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-1' })
  })
})
