import type { Role, User } from '../types'
import { USERS } from '../data/mock'

const ACCOUNTS_KEY = 'vetmind.demo.accounts'
const SESSION_KEY = 'vetmind.demo.session'
const BACKEND_TOKEN_KEY = 'vetmind.backend.jwt'

export interface DemoAccount {
  id: string
  email: string
  /** Demo-only plaintext. Not production auth. */
  password: string
  name: string
  role: Role
  createdAt: string
}

export interface DemoSession {
  accountId: string
  email: string
  role: Role
  name: string
}

const SEED_ACCOUNTS: DemoAccount[] = [
  {
    id: 'acc-vet',
    email: 'vet@demo.local',
    password: 'demo1234',
    name: USERS.vet.name,
    role: 'vet',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'acc-expert',
    email: 'expert@demo.local',
    password: 'demo1234',
    name: USERS.expert.name,
    role: 'expert',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'acc-owner',
    email: 'owner@demo.local',
    password: 'demo1234',
    name: USERS.owner.name,
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'acc-clinic-owner',
    email: 'clinic-owner@demo.local',
    password: 'demo1234',
    name: USERS.clinic_owner.name,
    role: 'clinic_owner',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'acc-admin',
    email: 'admin@demo.local',
    password: 'demo1234',
    name: USERS.admin.name,
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

function readAccounts(): DemoAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(SEED_ACCOUNTS))
      return [...SEED_ACCOUNTS]
    }
    const parsed = JSON.parse(raw) as DemoAccount[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(SEED_ACCOUNTS))
      return [...SEED_ACCOUNTS]
    }
    return parsed
  } catch {
    return [...SEED_ACCOUNTS]
  }
}

function writeAccounts(accounts: DemoAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function listDemoCredentials(): { email: string; password: string; role: Role }[] {
  return SEED_ACCOUNTS.map(({ email, password, role }) => ({ email, password, role }))
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

/** When true, JWT is kept in sessionStorage (cleared when the tab/browser session ends). */
let preferSessionToken = false

export function setProtectedTokenMode(enabled: boolean) {
  preferSessionToken = enabled
  if (enabled) {
    try {
      const existing = localStorage.getItem(BACKEND_TOKEN_KEY)
      if (existing) {
        sessionStorage.setItem(PROTECTED_TOKEN_KEY, existing)
        localStorage.removeItem(BACKEND_TOKEN_KEY)
      }
    } catch {
      /* ignore */
    }
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(BACKEND_TOKEN_KEY)
  try {
    sessionStorage.removeItem(PROTECTED_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function getBackendAccessToken(): string | null {
  try {
    if (preferSessionToken) {
      return sessionStorage.getItem(PROTECTED_TOKEN_KEY) || localStorage.getItem(BACKEND_TOKEN_KEY)
    }
    return localStorage.getItem(BACKEND_TOKEN_KEY) || sessionStorage.getItem(PROTECTED_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setBackendAccessToken(token: string | null) {
  try {
    if (!token) {
      localStorage.removeItem(BACKEND_TOKEN_KEY)
      sessionStorage.removeItem(PROTECTED_TOKEN_KEY)
      return
    }
    if (preferSessionToken) {
      sessionStorage.setItem(PROTECTED_TOKEN_KEY, token)
      localStorage.removeItem(BACKEND_TOKEN_KEY)
    } else {
      localStorage.setItem(BACKEND_TOKEN_KEY, token)
      sessionStorage.removeItem(PROTECTED_TOKEN_KEY)
    }
  } catch {
    /* ignore */
  }
}

function saveSession(session: DemoSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function login(email: string, password: string): DemoSession {
  const normalized = email.trim().toLowerCase()
  const accounts = readAccounts()
  const account = accounts.find((a) => a.email.toLowerCase() === normalized)
  if (!account || account.password !== password) {
    throw new Error('E-posta veya şifre hatalı.')
  }
  const session: DemoSession = {
    accountId: account.id,
    email: account.email,
    role: account.role,
    name: account.name,
  }
  saveSession(session)
  return session
}

export function register(input: {
  name: string
  email: string
  password: string
  role: Role
}): DemoSession {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const password = input.password
  if (!name || name.length < 2) throw new Error('Ad soyad en az 2 karakter olmalı.')
  if (!email.includes('@')) throw new Error('Geçerli bir e-posta girin.')
  if (password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.')

  const accounts = readAccounts()
  if (accounts.some((a) => a.email.toLowerCase() === email)) {
    throw new Error('Bu e-posta ile zaten bir hesap var. Giriş yapın.')
  }

  const account: DemoAccount = {
    id: `acc-${Date.now()}`,
    email,
    password,
    name,
    role: input.role,
    createdAt: new Date().toISOString(),
  }
  writeAccounts([account, ...accounts])
  return login(email, password)
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
  }
}

export function postLoginPath(role: Role): string {
  if (role === 'vet') return '/dicom-yukle'
  return '/'
}

/** Seed demo accounts share this password with the FastAPI auth module. */
export const DEMO_PASSWORD = 'demo1234'

export function demoEmailForRole(role: Role): string {
  if (role === 'clinic_owner') return 'clinic-owner@demo.local'
  return `${role}@demo.local`
}
