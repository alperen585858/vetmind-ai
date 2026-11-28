import { CLINIC } from '../../../shared/demo/clinic'
import { buildAssessment, makeDocument } from '../../../shared/demo/caseTemplates'
import { confidenceLabel, studyLabel } from '../../../shared/lib/displayClean'
import { estimateAnalysisDurationMs } from '../../../shared/lib/analysisProgress'
import { today } from '../../../shared/lib/format'
import type { TranslateFn as Translate } from '../../../i18n'
import type { ClinicalInfo, DicomDemoKind, DicomUploadResponse, NeuroExam, Patient, Priority, VetCase } from '../../../shared/types'
import type { IntakeMode } from '../lib/analysisChannel'
import { instanceCountOf, type UploadFile } from './constants'

export type BuiltAssessment = ReturnType<typeof buildAssessment>

/** Placeholder AI block + draft shown when the backend analysis failed. */
export function failedAssessment(built: BuiltAssessment, errorMessage: string | null | undefined, stamp: string): BuiltAssessment {
  return {
    ...built,
    ai: {
      summary: `Analiz başarısız: ${errorMessage ?? 'unknown error'}.`,
      findings: [],
      differentials: [],
      recommendedTests: ['Analizi daha sonra yeniden deneyin. Uzman incelemesi zorunludur.'],
      validation: [{ kind: 'unsupported', text: 'Analiz başarısız', detail: errorMessage ?? 'failed' }],
      model: 'yapay zekâ',
      generatedAt: stamp,
    },
    draft: {
      klinikOzet: 'Analiz tamamlanamadı; taslak üretilemedi.',
      bulgular: 'Yapılandırılmış bulgu yok.',
      degerlendirme: errorMessage ?? 'failed',
      ayiriciTanilar: 'Üretilmedi.',
      oneriler: 'Klinik kullanım için uygun değildir.',
    },
  }
}

/** Case documents for the store: one DICOM summary document, or one per uploaded file. */
function caseDocuments(
  id: string,
  intakeMode: IntakeMode,
  dicomPreview: DicomUploadResponse | null,
  files: UploadFile[],
  patient: Patient,
  clinical: ClinicalInfo,
  built: BuiltAssessment,
  t: Translate,
): VetCase['documents'] {
  if (intakeMode !== 'dicom') {
    return files.map((f, i) => ({ ...makeDocument(`${id}-d${i}`, f.name, f.type, patient, clinical, built.imaging), size: f.size }))
  }
  if (!dicomPreview?.study) return []
  const classification = dicomPreview.classification
  return [
    {
      ...makeDocument(
        `${id}-dicom`,
        `DICOM study ${dicomPreview.study.study_instance_uid}`,
        'MR Raporu',
        patient,
        clinical,
        built.imaging,
      ),
      size: `${instanceCountOf(dicomPreview)} görüntü`,
      rawText: 'Yalnızca DICOM dosya bilgileri okundu; görüntü pikselleri klinik olarak yorumlanmadı.',
      extracted: [
        { field: 'StudyInstanceUID', value: dicomPreview.study.study_instance_uid, source: 'DICOM' },
        {
          field: 'Sınıflandırma',
          value: classification
            ? `${studyLabel(t, classification.suggested_modality, classification.suggested_anatomical_region)} (${confidenceLabel(t, classification.confidence)})`
            : '—',
          source: 'DICOM sınıflandırıcı',
        },
      ],
    },
  ]
}

export interface SubmittedCaseInput {
  backendCaseId: string
  backendJobId?: string
  backendOutcome: VetCase['backendOutcome']
  backendFindings: VetCase['backendFindings']
  backendDraft: VetCase['backendDraft']
  patient: Patient
  clinical: ClinicalInfo
  neuro: NeuroExam
  priority: Priority
  intakeMode: IntakeMode
  dicomPreview: DicomUploadResponse | null
  dicomFiles: File[]
  files: UploadFile[]
  built: BuiltAssessment
  stamp: string
  t: Translate
}

/** The store record for a case the backend accepted (non-DICOM channels). */
export function buildSubmittedCase(input: SubmittedCaseInput): VetCase {
  const { backendCaseId, backendOutcome, patient, clinical, built, stamp, intakeMode, dicomPreview, files } = input
  const id = backendCaseId
  return {
    id,
    no: backendCaseId.replace(/^case-/, 'VM-').toUpperCase(),
    patient,
    clinical,
    neuro: input.neuro,
    documents: caseDocuments(id, intakeMode, dicomPreview, files, patient, clinical, built, input.t),
    status: 'isleniyor',
    module: 'Nöroloji',
    priority: input.priority,
    createdAt: today(),
    clinic: CLINIC,
    vetName: 'Dr. Elif Kaya',
    ai: built.ai,
    aiDraft: built.draft,
    report: { ...built.draft },
    corrections: [],
    timeline: [
      { date: stamp, label: 'Vaka oluşturuldu', by: 'Dr. Elif Kaya' },
      {
        date: stamp,
        label:
          intakeMode === 'dicom'
            ? `DICOM metadata ingest (${instanceCountOf(dicomPreview) ?? input.dicomFiles.length} instance)`
            : `${files.length} tetkik belgesi yüklendi`,
        by: 'Dr. Elif Kaya',
      },
      { date: stamp, label: `Analiz: ${backendOutcome} (${backendCaseId})`, by: 'backend' },
    ],
    processingStartedAt: Date.now(),
    backendCaseId,
    backendJobId: input.backendJobId,
    backendOutcome,
    backendFindings: input.backendFindings,
    backendDraft: input.backendDraft,
    fromBackend: true,
  }
}

/** Status note, timeline label and toast shown when the (timed) analysis finishes. */
export function completionMessages(outcome: VetCase['backendOutcome']) {
  const statusNote =
    outcome === 'failed'
      ? 'Analiz başarısız. Bu uzman revizyon talebi değildir; onaylanabilir AI taslak yoktur.'
      : outcome === 'unsupported'
        ? 'Desteklenmeyen görüntüleme kombinasyonu. Manuel radyolog incelemesi gerekir; AI draft onayı kapalıdır.'
        : undefined
  const timelineLabel =
    outcome === 'failed'
      ? 'Analiz başarısız — AI draft üretilmedi'
      : outcome === 'unsupported'
        ? 'Analiz: unsupported → manuel inceleme (AI draft yok)'
        : `Analiz tamamlandı (${outcome}) — uzman incelemesine bırakıldı`
  const tone: 'error' | 'warning' | 'success' = outcome === 'failed' ? 'error' : outcome === 'unsupported' ? 'warning' : 'success'
  const title =
    outcome === 'failed' ? 'Analiz başarısız' : outcome === 'unsupported' ? 'Manuel incelemeye yönlendirildi' : 'AI ön değerlendirmesi hazır'
  return { statusNote, timelineLabel, tone, title }
}

/** Structured clinical history sent with scenario-based analysis requests. */
export function buildStructuredHistory(patient: Patient, clinical: ClinicalInfo, neuro: NeuroExam, questions: string) {
  return {
    complaint: clinical.complaint || undefined,
    onset: clinical.onset || undefined,
    course: clinical.course || undefined,
    medications: clinical.medications || undefined,
    relevant_history: clinical.history || undefined,
    radiologist_questions: questions || undefined,
    handoff_notes: `Klinik→radyolog handoff · ${patient.species} · ${patient.breed || '—'} · ${patient.sex}${patient.neutered ? ' (kısır)' : ''} · ${patient.weight || '?'} kg`,
    sex: patient.sex || undefined,
    weight_kg: patient.weight > 0 ? patient.weight : undefined,
    neutered: patient.neutered,
    neuro_exam: {
      consciousness: neuro.consciousness,
      gait: neuro.gait,
      limbs: neuro.limbs,
      posturalThoracic: neuro.posturalThoracic,
      posturalPelvic: neuro.posturalPelvic,
      reflexThoracic: neuro.reflexThoracic,
      reflexPelvic: neuro.reflexPelvic,
      cranialNervesStatus: neuro.cranialNervesStatus,
      cranialNerves: neuro.cranialNervesStatus === 'Bulgu var' ? neuro.cranialNerves : [],
      deepPain: neuro.deepPain,
      hyperesthesia: neuro.hyperesthesia,
    },
  }
}

/** Placeholder store record while the background DICOM analysis task (#98) runs. */
export function buildPendingDicomCase(input: {
  pendingId: string
  patient: Patient
  clinical: ClinicalInfo
  neuro: NeuroExam
  priority: Priority
  stamp: string
  instanceCount: number
  demoKind: DicomDemoKind | null
  built: BuiltAssessment
}): VetCase {
  const { pendingId, built } = input
  return {
    id: pendingId,
    no: pendingId.replace(/^pending-/, 'VM-').toUpperCase(),
    patient: input.patient,
    clinical: input.clinical,
    neuro: input.neuro,
    documents: [],
    status: 'ai_analizi',
    module: 'Nöroloji',
    priority: input.priority,
    createdAt: today(),
    clinic: CLINIC,
    vetName: 'Dr. Elif Kaya',
    corrections: [],
    timeline: [{ date: input.stamp, label: 'Analiz hazırlanıyor', by: 'Dr. Elif Kaya' }],
    processingStartedAt: Date.now(),
    processingMs: estimateAnalysisDurationMs(input.instanceCount),
    dicomDemoKind: input.demoKind ?? undefined,
    instanceCount: input.instanceCount,
    ai: built.ai,
    aiDraft: built.draft,
    report: { ...built.draft },
  }
}
