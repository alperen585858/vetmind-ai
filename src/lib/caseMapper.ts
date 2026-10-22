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
import { CLINIC } from '../data/mock'

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

function basePatient(name: string, species: Species, breed?: string | null): Patient {
  return {
    name,
    species,
    breed: breed || '—',
    sex: 'Erkek',
    neutered: false,
    age: 0,
    weight: 0,
    ownerName: '—',
    ownerPhone: '',
  }
}

/** Lightweight row for list views (from CaseSummary). */
export function summaryToVetCase(s: BackendCaseSummary): VetCase {
  const species = speciesFromBackend(s.species)
  const status = caseStatusFromLifecycle(s.status)
  const created = s.created_at.slice(0, 10)
  return {
    id: s.case_id,
    no: s.case_id.replace(/^case-/, 'VM-').toUpperCase(),
    patient: basePatient(s.patient_name, species),
    clinical: emptyClinical(),
    neuro: EMPTY_NEURO,
    documents: [],
    status,
    module: 'Nöroloji',
    priority: 'Normal',
    createdAt: created,
    clinic: CLINIC,
    vetName: 'Backend',
    corrections: [],
    timeline: [{ date: s.created_at, label: 'Backend’den yüklendi', by: 'sync' }],
    backendCaseId: s.case_id,
    backendJobId: s.latest_job_id ?? undefined,
    fromBackend: true,
    statusNote: modalityNote(s.modality, s.anatomical_region),
  }
}

/** Full hydrate from CaseRecord (findings + draft when present). */
export function recordToVetCase(r: BackendCaseRecord): VetCase {
  const species = speciesFromBackend(r.species)
  const status = caseStatusFromLifecycle(r.status)
  const clinical = emptyClinical(r.clinical_history)
  const patient = basePatient(r.patient_name, species, r.breed)
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
  }

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
    priority: 'Normal',
    createdAt: created,
    clinic: r.referring_clinic || CLINIC,
    vetName: 'Backend',
    ai,
    aiDraft,
    report,
    corrections: [],
    timeline: [
      { date: r.created_at, label: 'Backend vakası', by: 'api' },
      ...(r.latest_job_id ? [{ date: r.updated_at, label: `Son job: ${r.latest_job_id}`, by: 'backend' }] : []),
    ],
    backendCaseId: r.case_id,
    backendJobId: r.latest_job_id ?? undefined,
    backendOutcome,
    backendFindings,
    backendDraft,
    fromBackend: true,
    statusNote: modalityNote(r.modality, r.anatomical_region),
  }
}

/** Merge: backend cases replace same ids; keep local-only demo seeds. */
export function mergeBackendCases(local: VetCase[], backend: VetCase[]): VetCase[] {
  const backendIds = new Set(backend.map((c) => c.id))
  const keptLocal = local.filter((c) => !c.fromBackend && !backendIds.has(c.id) && c.id !== c.backendCaseId)
  // Drop local shadows that already point at a backend id
  const cleaned = keptLocal.filter((c) => !c.backendCaseId || !backendIds.has(c.backendCaseId))
  return [...backend, ...cleaned]
}
