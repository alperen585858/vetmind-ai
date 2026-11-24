import { buildAssessment, makeDocument } from '../../../shared/demo/caseTemplates'
import { localize } from '../../../shared/lib/neuroLocalization'
import { nowStamp, today } from '../../../shared/lib/format'
import { studyLabel as formatStudyLabel } from '../../../shared/lib/displayClean'
import { estimateAnalysisDurationMs } from '../../../shared/lib/analysisProgress'
import { UNEVALUATED_NEURO } from '../../../shared/lib/neuroExam'
import type { BackendAnalysisJob, confirmDicomAndEnqueueAnalyze } from '../../../shared/api'
import type { AnalyzeHandoff } from '../../../shared/lib/analyzeHandoff'
import type { TranslateFn } from '../../../i18n'
import type { ClinicalInfo, NeuroExam, Patient, Priority, VetCase } from '../../../shared/types'

const EMPTY_NEURO: NeuroExam = UNEVALUATED_NEURO

/** Client-side case record for a DICOM study that was just queued for AI analysis. */
export function buildCaseFromHandoff(
  handoff: AnalyzeHandoff,
  caseRecord: Awaited<ReturnType<typeof confirmDicomAndEnqueueAnalyze>>['case'],
  job: BackendAnalysisJob,
  uploadSnap: AnalyzeHandoff['uploadSnap'],
  locale: 'tr' | 'en',
  t: TranslateFn,
): VetCase {
  const parsedAge = handoff.ageYears.trim() === '' ? 0 : Number(handoff.ageYears)
  const patient: Patient = {
    name: handoff.patientName,
    species: handoff.species,
    breed: handoff.breed,
    sex: 'Erkek',
    neutered: true,
    age: Number.isFinite(parsedAge) ? parsedAge : 0,
    weight: 0,
    ownerName: handoff.ownerName || t('reports.doc.owner'),
    ownerPhone: '',
  }
  const clinical: ClinicalInfo = {
    complaint: handoff.history.split('\n')[0] || t('dicom.title'),
    onset: 'Akut',
    course: 'Progresif',
    history: handoff.history,
    medications: '',
  }
  const neuro = EMPTY_NEURO
  const stamp = nowStamp()
  const loc = localize(neuro, clinical, locale)
  const built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp, locale)
  const id = caseRecord.case_id
  const instanceCount =
    uploadSnap?.study?.series.reduce((n, s) => n + s.instances.length, 0) ??
    caseRecord.dicom_study?.series?.reduce((n, s) => n + (s.instances?.length ?? 0), 0) ??
    handoff.files.length
  const priority: Priority = 'Normal'

  return {
    id,
    no: id.replace(/^case-/, 'VM-').toUpperCase(),
    patient,
    clinical,
    neuro,
    documents: [
      {
        ...makeDocument(
          `${id}-dicom`,
          `DICOM study ${uploadSnap?.study?.study_instance_uid ?? 'pending'}`,
          'MR Raporu',
          patient,
          clinical,
          built.imaging,
        ),
        size: `${instanceCount} görüntü`,
        rawText: 'Yalnızca DICOM dosya bilgileri okundu; görüntü pikselleri analiz edilmedi.',
        extracted: [
          {
            field: 'StudyInstanceUID',
            value: uploadSnap?.study?.study_instance_uid ?? '—',
            source: 'DICOM',
          },
          {
            field: 'Sınıflandırma',
            value: uploadSnap?.classification
              ? formatStudyLabel(
                  t,
                  uploadSnap.classification.suggested_modality,
                  uploadSnap.classification.suggested_anatomical_region,
                )
              : '—',
            source: 'DICOM sınıflandırıcı',
          },
        ],
      },
    ],
    status: 'ai_analizi',
    module: 'Nöroloji',
    priority,
    createdAt: today(),
    clinic: '',
    vetName: handoff.vetName,
    ai: built.ai,
    aiDraft: built.draft,
    report: { ...built.draft },
    corrections: [],
    timeline: [
      { date: stamp, label: 'Giriş sonrası DICOM metadata yüklendi', by: handoff.vetName },
      { date: stamp, label: `Analiz kuyruğa alındı (${job.job_id})`, by: 'Sistem' },
    ],
    processingStartedAt: Date.now(),
    processingMs: estimateAnalysisDurationMs(instanceCount),
    backendCaseId: id,
    backendJobId: job.job_id,
    fromBackend: true,
    dicomDemoKind: handoff.pendingDemo ?? undefined,
    modality: caseRecord.modality,
    anatomicalRegion: caseRecord.anatomical_region,
    studyInstanceUid: caseRecord.dicom_study?.study_instance_uid,
    instanceCount,
  }
}
