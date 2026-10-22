import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { KbSource, Role, User, VetCase } from '../types'
import { KB_SOURCES, SEED_CASES, USERS } from '../data/mock'
import { loadSession, logout as clearAuthSession, userFromSession, type DemoSession } from '../lib/auth'
import { BackendUnavailableError, getBackendCase, listBackendCases } from '../lib/backend'
import { mergeBackendCases, recordToVetCase, summaryToVetCase } from '../lib/caseMapper'

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'success' | 'info' | 'warning' | 'error'
}

interface AppState {
  role: Role | null
  session: DemoSession | null
  setRole: (r: Role | null) => void
  signIn: (session: DemoSession) => void
  signOut: () => void
  user: User | null
  cases: VetCase[]
  getCase: (id: string) => VetCase | undefined
  addCase: (c: VetCase) => void
  updateCase: (id: string, patch: Partial<VetCase> | ((c: VetCase) => Partial<VetCase>)) => void
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

const Ctx = createContext<AppState | null>(null)

function initialSession(): DemoSession | null {
  return loadSession()
}

export function AppProvider({ children }: { children: ReactNode }) {
  const boot = initialSession()
  const [session, setSession] = useState<DemoSession | null>(boot)
  const [role, setRoleState] = useState<Role | null>(boot?.role ?? null)
  const [cases, setCases] = useState<VetCase[]>(SEED_CASES)
  const [kbSources, setKb] = useState<KbSource[]>(KB_SOURCES)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [backendSyncing, setBackendSyncing] = useState(false)

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
    setSession(null)
    setRoleState(null)
    setSourceId(null)
  }, [])

  const setRole = useCallback((r: Role | null) => {
    if (r === null) {
      clearAuthSession()
      setSession(null)
      setRoleState(null)
      setSourceId(null)
      return
    }
    setRoleState(r)
    setSession((prev) => {
      if (!prev) {
        const demo: DemoSession = {
          accountId: `role-${r}`,
          email: `${r}@demo.local`,
          role: r,
          name: USERS[r].name,
        }
        localStorage.setItem('vetmind.demo.session', JSON.stringify(demo))
        return demo
      }
      const updated = { ...prev, role: r, name: prev.name || USERS[r].name }
      localStorage.setItem('vetmind.demo.session', JSON.stringify(updated))
      return updated
    })
    setSourceId(null)
  }, [])

  const value = useMemo<AppState>(
    () => ({
      role,
      session,
      setRole,
      signIn,
      signOut,
      user: session ? userFromSession(session) : role ? USERS[role] : null,
      cases,
      getCase: (id) => cases.find((c) => c.id === id || c.backendCaseId === id),
      addCase: (c) => setCases((all) => [c, ...all.filter((x) => x.id !== c.id)]),
      updateCase,
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
      cases,
      kbSources,
      toasts,
      sourceId,
      backendSyncing,
      setRole,
      signIn,
      signOut,
      updateCase,
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
