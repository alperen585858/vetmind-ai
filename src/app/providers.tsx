import type { ReactNode } from 'react'
import { AuthProvider } from '../shared/auth/AuthContext'
import { CaseProvider } from '../features/cases/CaseStore'
import { KbSourcesProvider } from '../features/rag-admin/KbSourcesContext'
import { ToastProvider } from '../shared/ui/ToastContext'
import { AppStateProvider } from '../shared/shell/AppContext'
import { useMergedAppState } from './useApp'

function MergedAppState({ children }: { children: ReactNode }) {
  const value = useMergedAppState()
  return <AppStateProvider value={value}>{children}</AppStateProvider>
}

/** Composition root: feature providers nested here, not inside shared. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CaseProvider>
        <KbSourcesProvider>
          <ToastProvider>
            <MergedAppState>{children}</MergedAppState>
          </ToastProvider>
        </KbSourcesProvider>
      </CaseProvider>
    </AuthProvider>
  )
}
