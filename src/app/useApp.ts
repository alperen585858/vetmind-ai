import { useMemo } from 'react'
import { useAuth } from '../shared/auth/AuthContext'
import { useCases } from '../features/cases/CaseStore'
import { useKbSources } from '../features/rag-admin/KbSourcesContext'
import { useToasts } from '../shared/ui/ToastContext'

/** Merged auth, case, knowledge-base, and toast state. */
export type AppState = ReturnType<typeof useAuth> &
  ReturnType<typeof useCases> &
  ReturnType<typeof useKbSources> &
  ReturnType<typeof useToasts>

/**
 * Composition-root merge. `AppProviders` publishes the result through
 * `AppStateProvider`; pages read it with `useApp()` from shared/shell/AppContext.
 */
export function useMergedAppState(): AppState {
  const auth = useAuth()
  const cases = useCases()
  const kb = useKbSources()
  const toasts = useToasts()
  return useMemo(
    () => ({ ...auth, ...cases, ...kb, ...toasts }),
    [auth, cases, kb, toasts],
  )
}
