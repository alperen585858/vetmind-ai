import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { KbSource, Role, User, VetCase } from '../types'
import { KB_SOURCES, USERS } from '../data/mock'
import {
  demoEmailForRole,
  loadSession,
  logout as clearAuthSession,
  userFromSession,
  type DemoSession,
} from '../lib/auth'
import {
  BackendUnavailableError,
  backendAuthStatus,
  getBackendCase,
  getUserSettings,
  listBackendCases,
} from '../lib/backend'
import { mergeBackendCases, recordToVetCase, summaryToVetCase } from '../lib/caseMapper'
import { clearDicomCaseCache } from '../lib/dicomCaseCache'

export type UserProfilePatch = {
  displayName?: string
  org?: string
}

function initialsFromName(name: string, fallback: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return initials || fallback
}

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'success' | 'info' | 'warning' | 'error'
}

/** Live /auth/status snapshot — drives demo-only UI (role switcher, Gate hints). */
export type BackendAuthMode = {
  authEnabled: boolean
  deploymentMode: string
  /** True when JWT auth is off and deployment is not protected (demo/local). */
  roleSwitchAllowed: boolean
}

interface AppState {
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
  cases: VetCase[]
  getCase: (id: string) => VetCase | undefined
  addCase: (c: VetCase) => void
  updateCase: (id: string, patch: Partial<VetCase> | ((c: VetCase) => Partial<VetCase>)) => void
  removeCase: (id: string) => void
  refreshBackendCases: () => Promise<{ ok: boolean; count: number; error?: string }>
  hydrateBackendCase: (caseId: string) => Promise<VetCase | null>
  backendSyncing: boolean
  kbSources: KbSource[]
  addKbSource: (s: KbSource) => void
  updateKbSource: (id: number, patch: Partial<KbSource>) => void
  toasts: Toast[]
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  sourceId: number | null
  openSource: (id: number) => void
  closeSource: () => void
}

const DEFAULT_AUTH_MODE: BackendAuthMode = {
  authEnabled: false,
  deploymentMode: 'demo',
  roleSwitchAllowed: true,
}

const Ctx = createContext<AppState | null>(null)

function initialSession(): DemoSession | null {
  return loadSession()
}

export function AppProvider({ children }: { children: ReactNode }) {
  const boot = initialSession()
  const [session, setSession] = useState<DemoSession | null>(boot)
  const [role, setRoleState] = useState<Role | null>(boot?.role ?? null)
  // Cases come only from the backend (demo set: VETMIND_DEMO_SEED / scripts/seed_demo.py).
  const [cases, setCases] = useState<VetCase[]>([])
  const [kbSources, setKb] = useState<KbSource[]>(KB_SOURCES)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [backendSyncing, setBackendSyncing] = useState(false)
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
      setAuthMode(DEFAULT_AUTH_MODE)
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

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((all) => [...all.slice(-2), { ...t, id }])
      setTimeout(() => dismissToast(id), 3500)
    },
    [dismissToast],
  )

  const updateCase = useCallback<AppState['updateCase']>((id, patch) => {
    setCases((all) => all.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)))
  }, [])

  const removeCase = useCallback<AppState['removeCase']>((id) => {
    setCases((all) => all.filter((c) => c.id !== id && c.backendCaseId !== id))
  }, [])

  const refreshBackendCases = useCallback(async () => {
    setBackendSyncing(true)
    try {
      const summaries = await listBackendCases()
      const mapped = summaries.map(summaryToVetCase)
      setCases((local) => mergeBackendCases(local, mapped))
      return { ok: true, count: mapped.length }
    } catch (err) {
      const error =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Backend senkronizasyonu başarısız'
      return { ok: false, count: 0, error }
    } finally {
      setBackendSyncing(false)
    }
  }, [])

  const hydrateBackendCase = useCallback(async (caseId: string) => {
    try {
      const record = await getBackendCase(caseId)
      const mapped = recordToVetCase(record)
      setCases((all) => {
        const without = all.filter((c) => c.id !== mapped.id && c.backendCaseId !== mapped.id)
        return [mapped, ...without]
      })
      return mapped
    } catch {
      return null
    }
  }, [])

  const signIn = useCallback((next: DemoSession) => {
    setSession(next)
    setRoleState(next.role)
    setSourceId(null)
  }, [])

  const signOut = useCallback(() => {
    clearAuthSession()
    void clearDicomCaseCache()
    setSession(null)
    setRoleState(null)
    setSourceId(null)
    setProfileOverride({})
  }, [])

  const setRole = useCallback((r: Role | null) => {
    if (r === null) {
      clearAuthSession()
      void clearDicomCaseCache()
      setSession(null)
      setRoleState(null)
      setSourceId(null)
      setProfileOverride({})
      return
    }
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
    setSourceId(null)
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

  const value = useMemo<AppState>(
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
      cases,
      getCase: (id) => cases.find((c) => c.id === id || c.backendCaseId === id),
      addCase: (c) => setCases((all) => [c, ...all.filter((x) => x.id !== c.id)]),
      updateCase,
      removeCase,
      refreshBackendCases,
      hydrateBackendCase,
      backendSyncing,
      kbSources,
      addKbSource: (s) => setKb((all) => [s, ...all]),
      updateKbSource: (id, patch) => setKb((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s))),
      toasts,
      pushToast,
      dismissToast,
      sourceId,
      openSource: setSourceId,
      closeSource: () => setSourceId(null),
    }),
    [
      role,
      session,
      user,
      authMode,
      cases,
      kbSources,
      toasts,
      sourceId,
      backendSyncing,
      setRole,
      signIn,
      signOut,
      applyUserProfile,
      refreshUserProfile,
      refreshAuthMode,
      updateCase,
      removeCase,
      refreshBackendCases,
      hydrateBackendCase,
      pushToast,
      dismissToast,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp, AppProvider içinde kullanılmalı')
  return v
}
