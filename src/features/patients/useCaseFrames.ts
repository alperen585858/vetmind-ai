import { useEffect, useState } from 'react'
import { fetchCaseDicomFiles } from '../../shared/api'
import { MAX_VIEWER_FRAMES } from '../../shared/lib/dicomFolder'
import { cacheCaseDicomFiles, loadCachedCaseDicomFiles } from '../../shared/lib/dicomCaseCache'
import { buildDicomPreviews, type DicomFramePreview } from '../../shared/lib/dicomPreview'

export type CaseFramesState = {
  frames: DicomFramePreview[]
  loading: boolean
  /** True when the case has no stored DICOM (e.g. a scenario case). */
  empty: boolean
  error: string | null
}

/** DICOM frames of a backend case: browser cache first, then the case's quarantined files. */
export function useCaseFrames(caseId: string | null): CaseFramesState {
  const [state, setState] = useState<CaseFramesState>({ frames: [], loading: Boolean(caseId), empty: false, error: null })

  useEffect(() => {
    if (!caseId) {
      setState({ frames: [], loading: false, empty: true, error: null })
      return
    }
    let cancelled = false
    setState({ frames: [], loading: true, empty: false, error: null })
    void (async () => {
      try {
        let files = await loadCachedCaseDicomFiles(caseId)
        if (!files?.length) {
          files = await fetchCaseDicomFiles(caseId)
          if (files.length) void cacheCaseDicomFiles(caseId, files.slice(0, MAX_VIEWER_FRAMES))
        }
        if (cancelled) return
        if (!files.length) {
          setState({ frames: [], loading: false, empty: true, error: null })
          return
        }
        const frames = await buildDicomPreviews(files.slice(0, MAX_VIEWER_FRAMES))
        if (!cancelled) setState({ frames, loading: false, empty: false, error: null })
      } catch (err) {
        if (!cancelled) {
          setState({ frames: [], loading: false, empty: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseId])

  return state
}
