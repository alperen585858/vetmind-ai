import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { KbSource, Role, VetCase } from '../types'
import { KB_SOURCES, SEED_CASES, USERS } from '../data/mock'

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'success' | 'info' | 'warning' | 'error'
}

interface AppState {
  role: Role | null
  setRole: (r: Role | null) => void
  user: (typeof USERS)[Role] | null
  cases: VetCase[]
  getCase: (id: string) => VetCase | undefined
  addCase: (c: VetCase) => void
  updateCase: (id: string, patch: Partial<VetCase> | ((c: VetCase) => Partial<VetCase>)) => void
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null)
  const [cases, setCases] = useState<VetCase[]>(SEED_CASES)
  const [kbSources, setKb] = useState<KbSource[]>(KB_SOURCES)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sourceId, setSourceId] = useState<number | null>(null)

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

  const value = useMemo<AppState>(
    () => ({
      role,
      setRole: (r) => {
        setRole(r)
        setSourceId(null)
      },
      user: role ? USERS[role] : null,
      cases,
      getCase: (id) => cases.find((c) => c.id === id),
      addCase: (c) => setCases((all) => [c, ...all]),
      updateCase,
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
    [role, cases, kbSources, toasts, sourceId, updateCase, pushToast, dismissToast],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp, AppProvider içinde kullanılmalı')
  return v
}
