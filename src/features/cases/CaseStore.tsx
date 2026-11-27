import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { VetCase } from '../../shared/types'
import { BackendUnavailableError, getBackendCase, listBackendCases } from '../../shared/api'
import { canonicalizeCaseId } from '../../shared/lib/caseId'
import { mergeBackendCases, recordToVetCase, summaryToVetCase } from '../../shared/lib/caseMapper'
import { SESSION_RESET_EVENT } from '../../shared/auth/AuthContext'

type CaseContextValue = {
  cases: VetCase[]
  getCase: (id: string) => VetCase | undefined
  addCase: (c: VetCase) => void
  updateCase: (id: string, patch: Partial<VetCase> | ((c: VetCase) => Partial<VetCase>)) => void
  removeCase: (id: string) => void
  refreshBackendCases: () => Promise<{ ok: boolean; count: number; error?: string }>
  hydrateBackendCase: (caseId: string) => Promise<VetCase | null>
  backendSyncing: boolean
}

const Ctx = createContext<CaseContextValue | null>(null)

export function CaseProvider({ children }: { children: ReactNode }) {
  // Cases come only from the backend (demo set: VETMIND_DEMO_SEED / scripts/seed_demo.py).
  const [cases, setCases] = useState<VetCase[]>([])
  const [backendSyncing, setBackendSyncing] = useState(false)

  useEffect(() => {
    const onReset = () => setCases([])
    window.addEventListener(SESSION_RESET_EVENT, onReset)
    return () => window.removeEventListener(SESSION_RESET_EVENT, onReset)
  }, [])

  const updateCase = useCallback<CaseContextValue['updateCase']>((id, patch) => {
    setCases((all) => all.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)))
  }, [])

  const removeCase = useCallback<CaseContextValue['removeCase']>((id) => {
    setCases((all) => all.filter((c) => c.id !== id && c.backendCaseId !== id))
  }, [])

  const addCase = useCallback<CaseContextValue['addCase']>((c) => {
    setCases((all) => [c, ...all.filter((x) => x.id !== c.id)])
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
            : 'Backend sync failed'
      return { ok: false, count: 0, error }
    } finally {
      setBackendSyncing(false)
    }
  }, [])

  const hydrateBackendCase = useCallback(async (caseId: string) => {
    try {
      const record = await getBackendCase(canonicalizeCaseId(caseId))
      const mapped = recordToVetCase(record)
      setCases((all) => {
        const prev = all.find((c) => c.id === mapped.id || c.backendCaseId === mapped.id)
        // The full record has no reviewer name (#77); keep the one from the list.
        if (prev?.assignedReviewerName && prev.assignedReviewerId === mapped.assignedReviewerId) {
          mapped.assignedReviewerName = prev.assignedReviewerName
        }
        const without = all.filter((c) => c.id !== mapped.id && c.backendCaseId !== mapped.id)
        return [mapped, ...without]
      })
      return mapped
    } catch {
      return null
    }
  }, [])

  const getCase = useCallback<CaseContextValue['getCase']>(
    (id) => {
      const key = canonicalizeCaseId(id)
      const upperNo = id.trim().toUpperCase()
      return cases.find(
        (c) =>
          c.id === id ||
          c.backendCaseId === id ||
          c.id === key ||
          c.backendCaseId === key ||
          c.no === upperNo ||
          c.no === id,
      )
    },
    [cases],
  )

  const value = useMemo<CaseContextValue>(
    () => ({
      cases,
      getCase,
      addCase,
      updateCase,
      removeCase,
      refreshBackendCases,
      hydrateBackendCase,
      backendSyncing,
    }),
    [cases, getCase, addCase, updateCase, removeCase, refreshBackendCases, hydrateBackendCase, backendSyncing],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCases() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCases, CaseProvider içinde kullanılmalı')
  return v
}
