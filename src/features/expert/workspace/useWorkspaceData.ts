import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { currentActorId } from '../../../shared/auth/session'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import { canonicalizeCaseId, isBackendCaseId } from '../../../shared/lib/caseId'
import { buildDicomPreviews, type DicomFramePreview } from '../../../shared/lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../../../shared/lib/dicomFolder'
import {
  BackendUnavailableError,
  PollingCancelledError,
  fetchCaseDicomFiles,
  listBackendWorklist,
  listReportVersions,
} from '../../../shared/api'
import type { BackendCaseSummary, VetCase } from '../../../shared/types'

export interface ReportVersionRow {
  version: number
  immutable: boolean
  status: string
}

/** DICOM frames of the case, with one retry for the brief 404 during analyze handoff. */
export function useCaseFrames(c: VetCase | undefined) {
  const { t } = useLocale()
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!c) return
    let cancelled = false
    const ac = new AbortController()
    setLoadingFrames(true)
    setError(null)
    void (async () => {
      const caseKey = canonicalizeCaseId(c.backendCaseId || c.id)
      const load = async () => {
        // Fetches all linked DICOM ingests (primary + attachment_refs); decode yields for large studies.
        const files = await fetchCaseDicomFiles(caseKey, MAX_VIEWER_FRAMES)
        if (cancelled) return
        const decoded = await buildDicomPreviews(files, { signal: ac.signal })
        if (cancelled) return
        setFrames(decoded)
      }
      try {
        await load()
      } catch (firstErr) {
        if (cancelled) return
        const firstName = firstErr instanceof Error ? firstErr.name : ''
        if (firstName === 'AbortError' || firstErr instanceof PollingCancelledError) return
        // One retry: backend reload / brief 404 during analyze handoff.
        try {
          await new Promise((r) => setTimeout(r, 400))
          if (cancelled) return
          await load()
        } catch (err) {
          if (cancelled) return
          setFrames([])
          const raw =
            err instanceof BackendUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : t('review.workspace.dicomLoadFailed')
          setError(/case not found/i.test(raw) ? t('review.workspace.dicomCaseMissing') : raw)
        }
      } finally {
        if (!cancelled) setLoadingFrames(false)
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the case identity changes
  }, [c?.id, c?.backendCaseId, t])

  return { frames, loadingFrames, error, setError }
}

/** Report version history; `refresh` re-reads it after review actions. */
export function useReportVersions(c: VetCase | undefined) {
  const { pushToast } = useApp()
  const { t } = useLocale()
  const [versions, setVersions] = useState<ReportVersionRow[]>([])

  useEffect(() => {
    if (!c) return
    if (!c.backendCaseId && !isBackendCaseId(c.id)) return
    const caseKey = canonicalizeCaseId(c.backendCaseId || c.id)
    void listReportVersions(caseKey)
      .then((v) => setVersions(v.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status }))))
      .catch((err) => {
        setVersions([])
        pushToast({
          tone: 'error',
          title: t('review.workspace.versionsLoadFailed'),
          body: toastErrorBody(err, t),
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on case identity / status change
  }, [c?.id, c?.backendCaseId, c?.status, pushToast, t])

  const refresh = useCallback(async (caseKey: string) => {
    const history = await listReportVersions(caseKey)
    setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
  }, [])

  return { versions, refresh }
}

/** The radiologist's worklist (assigned cases first; falls back to the whole list). */
export function useWorklist(caseId: string) {
  const { pushToast } = useApp()
  const { t } = useLocale()
  const [worklist, setWorklist] = useState<BackendCaseSummary[]>([])

  useEffect(() => {
    void listBackendWorklist({ assigned_to: currentActorId() })
      .then(setWorklist)
      .catch(() =>
        listBackendWorklist()
          .then(setWorklist)
          .catch((err) => {
            setWorklist([])
            pushToast({
              tone: 'error',
              title: t('review.workspace.worklistLoadFailed'),
              body: toastErrorBody(err, t),
            })
          }),
      )
  }, [caseId, pushToast, t])

  return worklist
}

/** Evidence the radiologist accepted (or edited) and marked for the report. */
export function countReportableEvidence(c: VetCase | undefined): number {
  let n = 0
  for (const f of c?.backendFindings?.findings ?? []) {
    for (const ev of f.evidence_references ?? []) {
      if (!ev.include_in_report) continue
      if (ev.review_status !== 'accepted' && ev.review_status !== 'edited') continue
      n += 1
    }
  }
  return n
}
