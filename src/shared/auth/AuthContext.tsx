import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Role, User } from '../types'
import { USERS } from '../demo/users'
import {
  demoEmailForRole,
  loadSession,
  purgeLegacyLocalAccounts,
  logout as clearAuthSession,
  userFromSession,
  type DemoSession,
} from './session'
import { AUTH_EXPIRED_EVENT, backendAuthStatus, backendLogout, getUserSettings } from '../api'
import { clearDicomCaseCache } from '../lib/dicomCaseCache'
import { applyLocaleFromSettings } from '../shell/LocaleContext'
import { localizePath } from '../../i18n/paths'
import { isLocale, LOCALE_STORAGE_KEY, type Locale } from '../../i18n/types'

/** Fired on sign-in, sign-out, and role change so case and source state can reset. */
export const SESSION_RESET_EVENT = 'vetmind:session-reset'

function emitSessionReset() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_RESET_EVENT))
}

function storedLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(raw) ? raw : 'tr'
  } catch {
    return 'tr'
  }
}

export type UserProfilePatch = {
  displayName?: string
  org?: string
}

function initialsFromName(name: string, fallback: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return initials || fallback
}

/** Live /auth/status snapshot — drives demo-only UI (role switcher, Gate hints). */
export type BackendAuthMode = {
  authEnabled: boolean
  deploymentMode: string
  /** True when JWT auth is off and deployment is not protected (demo/local). */
  roleSwitchAllowed: boolean
}

type AuthContextValue = {
  role: Role | null
  session: DemoSession | null
  setRole: (r: Role | null) => void
  signIn: (session: DemoSession) => void
  signOut: () => void
  user: User | null
  /** Apply display name / org from Settings (or backend) into the live user header. */
  applyUserProfile: (patch: UserProfilePatch) => void
  refreshUserProfile: () => Promise<void>
  authMode: BackendAuthMode
  refreshAuthMode: () => Promise<void>
}

const DEFAULT_AUTH_MODE: BackendAuthMode = {
  authEnabled: false,
  deploymentMode: 'demo',
  roleSwitchAllowed: true,
}

const Ctx = createContext<AuthContextValue | null>(null)

function initialSession(): DemoSession | null {
  purgeLegacyLocalAccounts()
  return loadSession()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const boot = initialSession()
  const [session, setSession] = useState<DemoSession | null>(boot)
  const [role, setRoleState] = useState<Role | null>(boot?.role ?? null)
  const [profileOverride, setProfileOverride] = useState<UserProfilePatch>({})
  const [authMode, setAuthMode] = useState<BackendAuthMode>(DEFAULT_AUTH_MODE)

  const refreshAuthMode = useCallback(async () => {
    try {
      const status = await backendAuthStatus()
      const authEnabled = Boolean(status.auth_enabled)
      const deploymentMode = status.deployment_mode || 'demo'
      const roleSwitchAllowed = !authEnabled && deploymentMode !== 'protected'
      setAuthMode({ authEnabled, deploymentMode, roleSwitchAllowed })
    } catch {
      // Fail closed on status errors: do not enable demo role switch during outages.
      setAuthMode({
        authEnabled: true,
        deploymentMode: 'protected',
        roleSwitchAllowed: false,
      })
    }
  }, [])

  useEffect(() => {
    void refreshAuthMode()
  }, [refreshAuthMode])

  const applyUserProfile = useCallback((patch: UserProfilePatch) => {
    setProfileOverride((prev) => ({
      displayName: patch.displayName !== undefined ? patch.displayName : prev.displayName,
      org: patch.org !== undefined ? patch.org : prev.org,
    }))
    // Keep demo session name in sync so Topbar stays correct after refresh before settings load.
    setSession((prev) => {
      if (!prev || patch.displayName === undefined) return prev
      const name = patch.displayName.trim() || prev.name
      const next = { ...prev, name }
      try {
        localStorage.setItem('vetmind.demo.session', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const refreshUserProfile = useCallback(async () => {
    try {
      const s = await getUserSettings()
      applyUserProfile({
        displayName: s.display_name?.trim() ?? '',
        org: s.org?.trim() ?? '',
      })
      applyLocaleFromSettings(s.language)
      try {
        localStorage.setItem('vetmind.sidebar.collapsed', s.compact_sidebar ? '1' : '0')
        window.dispatchEvent(new Event('vetmind-sidebar-collapse'))
      } catch {
        /* ignore */
      }
    } catch {
      /* backend down — keep session/mock identity */
    }
  }, [applyUserProfile])

  useEffect(() => {
    if (!session && !role) {
      setProfileOverride({})
      return
    }
    void refreshUserProfile()
  }, [session?.email, role, refreshUserProfile])

  const signIn = useCallback((next: DemoSession) => {
    emitSessionReset()
    setSession(next)
    setRoleState(next.role)
  }, [])

  const resetSignedOut = useCallback(() => {
    clearAuthSession()
    void clearDicomCaseCache()
    emitSessionReset()
    setSession(null)
    setRoleState(null)
    setProfileOverride({})
  }, [])

  const signOut = useCallback(() => {
    // Reads the refresh token synchronously, before resetSignedOut clears it.
    void backendLogout()
    resetSignedOut()
  }, [resetSignedOut])

  // The backend refused to renew the session (expired, revoked, password changed):
  // sign out and land on the login page with a short notice.
  useEffect(() => {
    const onExpired = () => {
      resetSignedOut()
      if (!/\/(giris|login)$/.test(window.location.pathname)) {
        window.location.assign(`${localizePath('/giris', storedLocale())}?expired=1`)
      }
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [resetSignedOut])

  const setRole = useCallback((r: Role | null) => {
    if (r === null) {
      void backendLogout()
      clearAuthSession()
      void clearDicomCaseCache()
      emitSessionReset()
      setSession(null)
      setRoleState(null)
      setProfileOverride({})
      return
    }
    // Drop prior role's cases before JWT/list refresh so UI never shows another actor's PHI.
    emitSessionReset()
    setRoleState(r)
    setProfileOverride({})
    setSession(() => {
      // Always bind role-switch to seed demo emails so backend JWT matches RBAC.
      const demo: DemoSession = {
        accountId: `role-${r}`,
        email: demoEmailForRole(r),
        role: r,
        name: USERS[r].name,
      }
      localStorage.setItem('vetmind.demo.session', JSON.stringify(demo))
      return demo
    })
  }, [])

  const user = useMemo<User | null>(() => {
    const base = session ? userFromSession(session) : role ? USERS[role] : null
    if (!base) return null
    const name = profileOverride.displayName?.trim() || base.name
    const org = profileOverride.org !== undefined ? profileOverride.org : base.org
    return {
      ...base,
      name,
      org,
      initials: initialsFromName(name, base.initials),
    }
  }, [session, role, profileOverride])

  const value = useMemo<AuthContextValue>(
    () => ({
      role,
      session,
      setRole,
      signIn,
      signOut,
      user,
      applyUserProfile,
      refreshUserProfile,
      authMode,
      refreshAuthMode,
    }),
    [role, session, setRole, signIn, signOut, user, applyUserProfile, refreshUserProfile, authMode, refreshAuthMode],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth, AuthProvider içinde kullanılmalı')
  return v
}
