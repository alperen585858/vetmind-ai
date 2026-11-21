import { createContext, useContext, type ReactNode } from 'react'
// Type-only. The composition root owns this shape; the import is erased at runtime.
import type { AppState } from '../../app/useApp'

export type { Toast } from '../ui/ToastContext'
export type { UserProfilePatch, BackendAuthMode } from '../auth/AuthContext'

const Ctx = createContext<AppState | null>(null)

/** Receives the merged state built by `src/app/providers.tsx`. */
export function AppStateProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Merged auth, cases, knowledge-base, and toast state. Existing pages keep calling this. */
export function useApp() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useApp, AppProviders içinde kullanılmalı')
  return value
}
