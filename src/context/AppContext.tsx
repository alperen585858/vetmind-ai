import { useMemo, type ReactNode } from 'react'
import { AuthProvider, useAuth } from '../shared/auth/AuthContext'
import { CaseProvider, useCases } from '../features/cases/CaseStore'
import { KbSourcesProvider, useKbSources } from '../features/rag-admin/KbSourcesContext'
import { ToastProvider, useToasts } from '../shared/ui/ToastContext'

export type { Toast } from '../shared/ui/ToastContext'
export type { UserProfilePatch, BackendAuthMode } from '../shared/auth/AuthContext'

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CaseProvider>
        <KbSourcesProvider>
          <ToastProvider>{children}</ToastProvider>
        </KbSourcesProvider>
      </CaseProvider>
    </AuthProvider>
  )
}

/** Merged auth, cases, knowledge-base, and toast state. Existing pages keep calling this. */
export function useApp() {
  const auth = useAuth()
  const cases = useCases()
  const kb = useKbSources()
  const toasts = useToasts()
  return useMemo(
    () => ({ ...auth, ...cases, ...kb, ...toasts }),
    [auth, cases, kb, toasts],
  )
}
