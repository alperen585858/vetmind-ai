import type { DicomDemoKind } from '../../../shared/types'

/** Where the case viewer's images came from. Every source belongs to the case itself. */
export type CaseStudySource =
  | { kind: 'cached'; files: File[] }
  | { kind: 'backend'; files: File[] }
  | { kind: 'demoCase'; files: File[]; demoKind: DicomDemoKind }
  | { kind: 'none'; files: [] }

export type CaseStudyDeps = {
  loadCached: (caseKey: string) => Promise<File[] | null>
  fetchBackend: (caseKey: string) => Promise<File[]>
  fetchDemo: (kind: DicomDemoKind, count: number) => Promise<File[]>
  cache: (caseKey: string, files: File[]) => Promise<void>
}

export type CaseStudyInput = {
  caseKey: string
  /** True when the case lives on the backend, so its quarantined DICOM can be fetched. */
  onBackend: boolean
  /** Set only for cases that were created from a demo fixture: those fixtures are the case's study. */
  demoKind?: DicomDemoKind
}

/**
 * Resolve the images that belong to one case, in order: this browser's cache of the
 * uploaded study, the backend quarantine copy, then the fixture the case was created from.
 * Only backend bytes are written to the cache. A backend error is thrown so the viewer
 * can offer a retry, unless the case has its own demo fixture to fall back on.
 */
export async function loadCaseStudy(input: CaseStudyInput, deps: CaseStudyDeps): Promise<CaseStudySource> {
  const cached = await deps.loadCached(input.caseKey)
  if (cached?.length) return { kind: 'cached', files: cached }

  if (input.onBackend) {
    try {
      const files = await deps.fetchBackend(input.caseKey)
      if (files.length) {
        void deps.cache(input.caseKey, files).catch(() => undefined)
        return { kind: 'backend', files }
      }
    } catch (err) {
      if (!input.demoKind) throw err
    }
  }

  if (input.demoKind) {
    const files = await deps.fetchDemo(input.demoKind, input.demoKind === 'thorax_xr' ? 1 : 12)
    return { kind: 'demoCase', files, demoKind: input.demoKind }
  }

  return { kind: 'none', files: [] }
}
