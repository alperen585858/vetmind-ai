/**
 * Study → Series → SOP identity helpers.
 * Never invents UIDs; only validates consistency of provided metadata.
 */

export type StudyIdentityInstance = {
  sop_instance_uid: string
  filename?: string | null
}

export type StudyIdentitySeries = {
  series_instance_uid: string
  instances: StudyIdentityInstance[]
}

export type StudyIdentityTree = {
  study_instance_uid: string
  series: StudyIdentitySeries[]
}

export type StudyIdentityIssue =
  | { code: 'EMPTY_STUDY_UID' }
  | { code: 'EMPTY_SERIES_UID'; seriesIndex: number }
  | { code: 'EMPTY_SOP_UID'; seriesIndex: number; instanceIndex: number }
  | { code: 'DUPLICATE_SERIES_UID'; series_instance_uid: string }
  | { code: 'DUPLICATE_SOP_UID'; sop_instance_uid: string }
  | { code: 'EMPTY_SERIES_LIST' }

/** Validate Study/Series/SOP UID uniqueness and non-emptiness. */
export function validateStudyIdentity(study: StudyIdentityTree | null | undefined): {
  ok: boolean
  issues: StudyIdentityIssue[]
} {
  const issues: StudyIdentityIssue[] = []
  if (!study) return { ok: false, issues: [{ code: 'EMPTY_STUDY_UID' }] }
  if (!study.study_instance_uid?.trim()) {
    issues.push({ code: 'EMPTY_STUDY_UID' })
  }
  if (!study.series?.length) {
    issues.push({ code: 'EMPTY_SERIES_LIST' })
  }
  const seriesSeen = new Set<string>()
  const sopSeen = new Set<string>()
  study.series?.forEach((series, seriesIndex) => {
    const suid = series.series_instance_uid?.trim()
    if (!suid) {
      issues.push({ code: 'EMPTY_SERIES_UID', seriesIndex })
    } else if (seriesSeen.has(suid)) {
      issues.push({ code: 'DUPLICATE_SERIES_UID', series_instance_uid: suid })
    } else {
      seriesSeen.add(suid)
    }
    series.instances?.forEach((inst, instanceIndex) => {
      const sop = inst.sop_instance_uid?.trim()
      if (!sop) {
        issues.push({ code: 'EMPTY_SOP_UID', seriesIndex, instanceIndex })
      } else if (sopSeen.has(sop)) {
        issues.push({ code: 'DUPLICATE_SOP_UID', sop_instance_uid: sop })
      } else {
        sopSeen.add(sop)
      }
    })
  })
  return { ok: issues.length === 0, issues }
}

/** Stable model-facing refs for future adapters (opaque UIDs + optional quarantine path). */
export function modelRefsFromStudy(study: StudyIdentityTree | null | undefined): {
  studyInstanceUid: string | null
  seriesInstanceUids: string[]
  sopInstanceUids: string[]
} {
  if (!study?.study_instance_uid) {
    return { studyInstanceUid: null, seriesInstanceUids: [], sopInstanceUids: [] }
  }
  const seriesInstanceUids = study.series.map((s) => s.series_instance_uid).filter(Boolean)
  const sopInstanceUids = study.series.flatMap((s) =>
    s.instances.map((i) => i.sop_instance_uid).filter(Boolean),
  )
  return {
    studyInstanceUid: study.study_instance_uid,
    seriesInstanceUids,
    sopInstanceUids,
  }
}
