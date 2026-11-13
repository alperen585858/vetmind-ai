import type { Locale } from '../i18n/types'
import { localizePath } from '../i18n/paths'
import type { Role, User } from '../types'
import { USERS } from '../data/mock'

const LEGACY_ACCOUNTS_KEY = 'vetmind.demo.accounts'
const SESSION_KEY = 'vetmind.demo.session'
const BACKEND_TOKEN_KEY = 'vetmind.backend.jwt'

export interface DemoSession {
  accountId: string
  email: string
  role: Role
  name: string
}

/** Seed accounts that exist in the backend (FastAPI DEMO_USERS); password is public demo data. */
const DEMO_ACCOUNTS: { email: string; role: Role; name: string }[] = [
  { email: 'vet@demo.local', role: 'vet', name: USERS.vet.name },
  { email: 'expert@demo.local', role: 'expert', name: USERS.expert.name },
  { email: 'owner@demo.local', role: 'owner', name: USERS.owner.name },
  { email: 'clinic-owner@demo.local', role: 'clinic_owner', name: USERS.clinic_owner.name },
  { email: 'admin@demo.local', role: 'admin', name: USERS.admin.name },
]

/**
 * Browser-only "accounts" (with plaintext passwords) were kept here before sign-up moved to
 * the backend (issue #31). Remove any left over in this browser.
 */
export function purgeLegacyLocalAccounts() {
  try {
    localStorage.removeItem(LEGACY_ACCOUNTS_KEY)
  } catch {
    /* ignore */
  }
}

export function listDemoCredentials(): { email: string; password: string; role: Role }[] {
  return DEMO_ACCOUNTS.map(({ email, role }) => ({ email, password: DEMO_PASSWORD, role }))
}

export function loadSession(): DemoSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as DemoSession
    if (!session?.email || !session?.role) return null
    return session
  } catch {
    return null
  }
}

const PROTECTED_TOKEN_KEY = 'vetmind.backend.jwt.session'
const BACKEND_REFRESH_KEY = 'vetmind.backend.refresh'
const PROTECTED_REFRESH_KEY = 'vetmind.backend.refresh.session'

/** [localStorage key, sessionStorage key] per token kind. */
const ACCESS_KEYS = [BACKEND_TOKEN_KEY, PROTECTED_TOKEN_KEY] as const
const REFRESH_KEYS = [BACKEND_REFRESH_KEY, PROTECTED_REFRESH_KEY] as const
type TokenKeys = readonly [string, string]

/** When true, tokens are kept in sessionStorage (cleared when the tab/browser session ends). */
let preferSessionToken = false

function readToken([localKey, sessionKey]: TokenKeys): string | null {
  try {
    if (preferSessionToken) {
      return sessionStorage.getItem(sessionKey) || localStorage.getItem(localKey)
    }
    return localStorage.getItem(localKey) || sessionStorage.getItem(sessionKey)
  } catch {
    return null
  }
}

function writeToken([localKey, sessionKey]: TokenKeys, token: string | null) {
  try {
    if (!token) {
      localStorage.removeItem(localKey)
      sessionStorage.removeItem(sessionKey)
      return
    }
    if (preferSessionToken) {
      sessionStorage.setItem(sessionKey, token)
      localStorage.removeItem(localKey)
    } else {
      localStorage.setItem(localKey, token)
      sessionStorage.removeItem(sessionKey)
    }
  } catch {
    /* ignore */
  }
}

export function setProtectedTokenMode(enabled: boolean) {
  preferSessionToken = enabled
  if (enabled) {
    for (const [localKey, sessionKey] of [ACCESS_KEYS, REFRESH_KEYS]) {
      try {
        const existing = localStorage.getItem(localKey)
        if (existing) {
          sessionStorage.setItem(sessionKey, existing)
          localStorage.removeItem(localKey)
        }
      } catch {
        /* ignore */
      }
    }
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  writeToken(ACCESS_KEYS, null)
  writeToken(REFRESH_KEYS, null)
}

export function getBackendAccessToken(): string | null {
  return readToken(ACCESS_KEYS)
}

export function getBackendRefreshToken(): string | null {
  return readToken(REFRESH_KEYS)
}

/** Clearing the access token (``null``) also drops the refresh token: the backend session ends. */
export function setBackendAccessToken(token: string | null) {
  writeToken(ACCESS_KEYS, token)
  if (!token) writeToken(REFRESH_KEYS, null)
}

/** Store the pair returned by /auth/login, /auth/register or /auth/refresh. */
export function setBackendTokens(tokens: { access_token: string; refresh_token?: string | null }) {
  writeToken(ACCESS_KEYS, tokens.access_token)
  writeToken(REFRESH_KEYS, tokens.refresh_token ?? null)
}

function saveSession(session: DemoSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

const ROLES: Role[] = ['vet', 'expert', 'owner', 'clinic_owner', 'admin']

/**
 * Session for an account that exists only in the backend directory (created by an
 * admin on Kullanıcılar). The backend has already verified the password.
 */
export function backendAccountSession(email: string, role: string, name?: string | null): DemoSession {
  if (!ROLES.includes(role as Role)) throw new Error('Bu hesabın rolü web arayüzünde desteklenmiyor.')
  const normalized = email.trim().toLowerCase()
  const seed = DEMO_ACCOUNTS.find((a) => a.email === normalized)
  const session: DemoSession = {
    accountId: `backend-${normalized}`,
    email: normalized,
    role: role as Role,
    name: name?.trim() || seed?.name || normalized.split('@')[0],
  }
  saveSession(session)
  return session
}

export function logout() {
  clearSession()
}

export function userFromSession(session: DemoSession): User {
  const base = USERS[session.role]
  const initials = session.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || base.initials
  return {
    ...base,
    name: session.name,
    initials,
    email: session.email,
  }
}

export function postLoginPath(role: Role, locale: Locale = 'tr'): string {
  const tr = role === 'vet' ? '/dicom-yukle' : '/'
  return localizePath(tr, locale)
}

/** Seed demo accounts share this password with the FastAPI auth module. */
export const DEMO_PASSWORD = 'demo1234'

export function demoEmailForRole(role: Role): string {
  if (role === 'clinic_owner') return 'clinic-owner@demo.local'
  return `${role}@demo.local`
}

/**
 * Identity sent as reviewer / editor / assignee: the signed-in user's email.
 * Matches the JWT subject the backend binds to when auth is on, so assignments,
 * worklist filters and notifications all use one id.
 */
export function currentActorId(): string {
  return loadSession()?.email ?? demoEmailForRole('expert')
}
