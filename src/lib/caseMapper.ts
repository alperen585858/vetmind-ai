import type {
  BackendAnatomicalRegion,
  BackendCaseRecord,
  BackendCaseSummary,
  BackendDraftReport,
  BackendFindings,
  BackendModality,
  CaseStatus,
  ClinicalInfo,
  NeuroExam,
  Patient,
  Species,
  VetCase,
} from '../types'
import { draftToSections, pipelineToAssessment } from './backend'
import { CLINIC, USERS } from '../data/mock'

const EMPTY_NEURO: NeuroExam = {
  consciousness: 'Uyanık',
  gait: 'Normal',
  limbs: [],
  posturalThoracic: 'Normal',
  posturalPelvic: 'Normal',
  reflexThoracic: 'Normal',
  reflexPelvic: 'Normal',
  cranialNerves: [],
  deepPain: 'Değerlendirilmedi',
  hyperesthesia: 'Yok',
}

export function speciesFromBackend(species: string): Species {
  if (species === 'feline') return 'Kedi'
  return 'Köpek'
}

/** Map backend CaseLifecycleStatus → frontend CaseStatus. */
export function caseStatusFromLifecycle(status: string): CaseStatus {
  switch (status) {
    case 'analyzing':
      return 'ai_analizi'
    case 'awaiting_review':
      return 'uzman_incelemesinde'
    case 'manual_review':
      return 'manuel_inceleme'
    case 'approved':
      return 'onaylandi'
    case 'rejected':
      return 'reddedildi'
    case 'revision_requested':
      return 'revizyon'
    case 'failed':
      return 'analiz_basarisiz'
    case 'awaiting_classification_confirmation':
    case 'created':
    default:
      return 'taslak'
  }
}

function regionLabel(region: BackendAnatomicalRegion | string | undefined): string {
  if (region === 'CERVICAL') return 'Servikal'
  if (region === 'BRAIN') return 'Beyin'
  return region || 'Nöroloji'
}

function modalityNote(modality: BackendModality | string | undefined, region: string): string {
  return `${modality ?? 'MR'} · ${regionLabel(region as BackendAnatomicalRegion)}`
}

function emptyClinical(history?: string | null): ClinicalInfo {
  return {
    complaint: history?.split('\n')[0] || 'Backend vakası',
    onset: 'Akut',
    course: 'Progresif',
    history: history || '',
    medications: '',
  }
}

function basePatient(
  name: string,
  species: Species,
  breed?: string | null,
  ownerLabel?: string | null,
): Patient {
  return {
    name,
    species,
    breed: breed || '—',
    sex: 'Erkek',
    neutered: false,
    age: 0,
    weight: 0,
    ownerName: ownerLabel?.trim() || '—',
    ownerPhone: '',
  }
}

function ownerLabelFromBackend(ownerSubject?: string | null, petOwnerSubject?: string | null): string {
  return (petOwnerSubject || ownerSubject || '').trim()
}

/** Lightweight row for list views (from CaseSummary). */
function priorityFromBackend(p?: string | null): VetCase['priority'] {
  if (p === 'stat') return 'STAT'
  if (p === 'urgent') return 'Acil'
  if (p === 'high') return 'Yüksek'
  return 'Normal'
}

export function summaryToVetCase(s: BackendCaseSummary): VetCase {
  const species = speciesFromBackend(s.species)
  const status = caseStatusFromLifecycle(s.status)
  const created = s.created_at.slice(0, 10)
  const owner = ownerLabelFromBackend(s.owner_subject, s.pet_owner_subject)
  const patient = basePatient(s.patient_name, species, s.breed, owner)
  if (s.patient_age_years != null) patient.age = s.patient_age_years
  return {
    id: s.case_id,
    no: s.case_id.replace(/^case-/, 'VM-').toUpperCase(),
    patient,
    clinical: emptyClinical(),
    neuro: EMPTY_NEURO,
    documents: [],
    status,
    module: 'Nöroloji',
    priority: priorityFromBackend(s.priority),
    createdAt: created,
    clinic: s.referring_clinic || s.clinic_id || CLINIC,
    vetName: USERS.vet.name,
    corrections: [],
    timeline: [{ date: s.created_at, label: 'Vaka oluşturuldu', by: 'Sistem' }],
    backendCaseId: s.case_id,
    backendJobId: s.latest_job_id ?? undefined,
    fromBackend: true,
    statusNote: modalityNote(s.modality, s.anatomical_region),
    modality: s.modality,
    anatomicalRegion: s.anatomical_region,
    classificationConfirmed: s.classification_confirmed ?? true,
    studyInstanceUid: s.study_instance_uid ?? undefined,
    seriesCount: s.series_count ?? undefined,
    instanceCount: s.instance_count ?? undefined,
    assignedReviewerId: s.assigned_reviewer_id ?? undefined,
    unreadMessages: s.unread_messages ?? 0,
    reportAvailableAt: s.report_available_at ?? undefined,
    reportDeliveredAt: s.report_delivered_at ?? undefined,
    reportViewedAt: s.report_viewed_at ?? undefined,
    petOwnerSubject: s.pet_owner_subject ?? undefined,
    petId: s.pet_id ?? undefined,
    submissionId: s.submission_id ?? undefined,
  }
}

/** Full hydrate from CaseRecord (findings + draft when present). */
export function recordToVetCase(r: BackendCaseRecord): VetCase {
  const species = speciesFromBackend(r.species)
  const status = caseStatusFromLifecycle(r.status)
  const structured = r.clinical_history_structured
  const clinical = emptyClinical(r.clinical_history)
  if (structured) {
    clinical.complaint = structured.complaint || clinical.complaint
    if (structured.onset === 'Akut' || structured.onset === 'Kronik') {
      clinical.onset = structured.onset
    }
    if (
      structured.course === 'Progresif' ||
      structured.course === 'Stabil' ||
      structured.course === 'İyileşen'
    ) {
      clinical.course = structured.course
    }
    clinical.medications = structured.medications || clinical.medications
    clinical.history = structured.relevant_history || clinical.history
  }
  const owner = ownerLabelFromBackend(r.owner_subject, r.pet_owner_subject)
  const patient = basePatient(r.patient_name, species, r.breed, owner)
  if (r.patient_age_years != null) patient.age = r.patient_age_years
  const created = r.created_at.slice(0, 10)

  let ai = undefined
  let aiDraft = undefined
  let report = undefined
  let backendOutcome: VetCase['backendOutcome']
  let backendFindings: BackendFindings | undefined
  let backendDraft: BackendDraftReport | undefined

  if (r.structured_findings && r.draft_report) {
    backendFindings = r.structured_findings
    backendDraft = r.draft_report
    ai = pipelineToAssessment(backendFindings, backendDraft)
    aiDraft = draftToSections(backendDraft)
    report = { ...aiDraft }
    backendOutcome = status === 'analiz_basarisiz' ? 'failed' : status === 'manuel_inceleme' ? 'unsupported' : 'success'
  } else if (r.structured_findings && !r.draft_report) {
    backendFindings = r.structured_findings
    backendOutcome = status === 'analiz_basarisiz' ? 'failed' : 'unsupported'
  } else if (r.draft_report) {
    backendDraft = r.draft_report
    aiDraft = draftToSections(backendDraft)
    report = { ...aiDraft }
  }

  const approveEntry = [...(r.review_history ?? [])].reverse().find((h) => h.action === 'approve')
  const approvedBy = approveEntry?.reviewer_id
  // Backend ReviewFeedback has no timestamp; case.updated_at is the best persisted signal after approve.
  const approvedAt = status === 'onaylandi' ? r.updated_at.slice(0, 10) : undefined
  const reportNo = status === 'onaylandi' ? r.case_id.replace(/^case-/, 'VMR-').toUpperCase() : undefined

  const reviewLabels: Record<string, string> = {
    approve: 'Uzman tarafından onaylandı',
    reject: 'Rapor reddedildi',
    request_revision: 'Revizyon istendi',
  }
  const reviewEvents = (r.review_history ?? []).map((h) => ({
    date: r.updated_at,
    label: `${reviewLabels[h.action] ?? h.action}${h.comment ? ` — ${h.comment}` : ''}`,
    by: ['expert@demo.local', 'expert-demo'].includes(h.reviewer_id) ? USERS.expert.name : h.reviewer_id,
  }))

  const docs =
    r.study?.dicom_available || r.dicom_study
      ? [
          {
            id: `${r.case_id}-dicom`,
            name: `DICOM ${r.study?.study_instance_uid ?? r.dicom_study?.study_instance_uid ?? 'study'}`,
            type: 'MR Raporu' as const,
            size: r.study?.instance_count ? `${r.study.instance_count} instance` : 'metadata',
            pages: 1,
            rawText: 'DICOM metadata ingest. Pixel data was not analyzed.',
            extracted: [
              {
                field: 'Modality / Region',
                value: modalityNote(r.modality, r.anatomical_region),
                source: 'case',
              },
            ],
          },
        ]
      : []

  return {
    id: r.case_id,
    no: r.case_id.replace(/^case-/, 'VM-').toUpperCase(),
    patient,
    clinical,
    neuro: EMPTY_NEURO,
    documents: docs,
    status,
    module: 'Nöroloji',
    priority: priorityFromBackend(r.priority),
    createdAt: created,
    clinic: r.referring_clinic || CLINIC,
    vetName: USERS.vet.name,
    ai,
    aiDraft,
    report,
    assignedReviewerId: r.assigned_reviewer_id ?? undefined,
    handoffNotes: structured?.handoff_notes ?? undefined,
    reportAvailableAt: r.report_available_at ?? undefined,
    reportDeliveredAt: r.report_delivered_at ?? undefined,
    reportViewedAt: r.report_viewed_at ?? undefined,
    corrections: [],
    timeline: [
      { date: r.created_at, label: 'Vaka oluşturuldu', by: 'Sistem' },
      ...(r.latest_job_id ? [{ date: r.updated_at, label: 'AI ön değerlendirmesi oluşturuldu', by: 'Sistem' }] : []),
      ...reviewEvents,
      ...(r.report_available_at
        ? [{ date: r.report_available_at, label: 'Onaylı rapor hazır', by: 'Sistem' }]
        : []),
      ...(r.report_delivered_at
        ? [{ date: r.report_delivered_at, label: 'Rapor kliniklere iletildi', by: 'Sistem' }]
        : []),
      ...(r.report_viewed_at
        ? [{ date: r.report_viewed_at, label: 'Rapor görüntülendi', by: 'Sistem' }]
        : []),
    ],
    backendCaseId: r.case_id,
    backendJobId: r.latest_job_id ?? undefined,
    backendOutcome,
    backendFindings,
    backendDraft,
    reportVersions: (r.report_versions || []).map((v) => ({
      version: v.version,
      report_id: v.report_id,
      case_id: v.case_id,
      created_at: v.created_at,
      updated_at: v.updated_at,
      author_or_source: v.author_or_source,
      status: v.status,
      expert_review_status: v.expert_review_status,
      immutable: Boolean(v.immutable),
      revision_notes: v.revision_notes,
      reviewed_by: v.reviewed_by,
      source_kind: v.source_kind,
      model_id: v.model_id,
      model_version: v.model_version,
      synthetic: Boolean(v.synthetic),
      is_current: Boolean(v.is_current) || v.version === r.current_report_version,
    })),
    currentReportVersion: r.current_report_version ?? r.draft_report?.version ?? undefined,
    fromBackend: true,
    approvedBy: approvedBy ?? r.draft_report?.reviewed_by ?? undefined,
    approvedAt,
    reportNo,
    statusNote:
      r.draft_report?.reviewer_comment ||
      modalityNote(r.modality, r.anatomical_region),
    modality: r.modality,
    anatomicalRegion: r.anatomical_region,
    classificationConfirmed: r.classification_confirmed,
    studyInstanceUid: r.study?.study_instance_uid ?? r.dicom_study?.study_instance_uid ?? undefined,
    seriesCount: r.study?.series_count ?? r.dicom_study?.series?.length ?? undefined,
    instanceCount:
      r.study?.instance_count ??
      r.dicom_study?.series?.reduce((n, s) => n + s.instances.length, 0) ??
      undefined,
    petOwnerSubject: r.pet_owner_subject ?? undefined,
    petId: r.pet_id ?? undefined,
    submissionId: r.submission_id ?? undefined,
  }
}

/** Expert-review facing label derived from case status (no invented review records). */
export function expertReviewLabel(status: CaseStatus): string {
  switch (status) {
    case 'uzman_incelemesinde':
      return 'Bekliyor'
    case 'onaylandi':
      return 'Onaylandı'
    case 'reddedildi':
      return 'Reddedildi'
    case 'revizyon':
      return 'Revizyon'
    case 'manuel_inceleme':
      return 'Manuel'
    case 'analiz_basarisiz':
      return 'Analiz yok'
    case 'ai_analizi':
    case 'isleniyor':
      return 'Analiz sürüyor'
    default:
      return '—'
  }
}

export function analysisStatusLabel(status: CaseStatus): string {
  switch (status) {
    case 'taslak':
      return 'Bekliyor'
    case 'isleniyor':
    case 'ai_analizi':
      return 'Analiz'
    case 'uzman_incelemesinde':
    case 'onaylandi':
    case 'reddedildi':
    case 'revizyon':
      return 'Tamamlandı'
    case 'analiz_basarisiz':
      return 'Başarısız'
    case 'manuel_inceleme':
      return 'Desteklenmiyor'
    default:
      return status
  }
}

/**
 * Merge list sync with in-memory cases.
 * Preserves hydrated report/findings when list API returns summary-only rows
 * (critical for print-PDF after refreshBackendCases).
 */
export function mergeBackendCases(local: VetCase[], backend: VetCase[]): VetCase[] {
  const hydrated = new Map(
    local
      .filter((c) => c.fromBackend && (c.backendDraft || c.backendFindings || c.report))
      .map((c) => [c.id, c]),
  )
  const mergedBackend = backend.map((row) => {
    const prev = hydrated.get(row.id)
    if (!prev) return row
    return {
      ...prev,
      status: row.status,
      backendJobId: row.backendJobId ?? prev.backendJobId,
      modality: row.modality ?? prev.modality,
      anatomicalRegion: row.anatomicalRegion ?? prev.anatomicalRegion,
      studyInstanceUid: row.studyInstanceUid ?? prev.studyInstanceUid,
      seriesCount: row.seriesCount ?? prev.seriesCount,
      instanceCount: row.instanceCount ?? prev.instanceCount,
      classificationConfirmed: row.classificationConfirmed ?? prev.classificationConfirmed,
      fromBackend: true,
    }
  })
  const backendIds = new Set(mergedBackend.map((c) => c.id))
  const keptLocal = local.filter((c) => !c.fromBackend && !backendIds.has(c.id) && c.id !== c.backendCaseId)
  const cleaned = keptLocal.filter((c) => !c.backendCaseId || !backendIds.has(c.backendCaseId))
  return [...mergedBackend, ...cleaned]
}
