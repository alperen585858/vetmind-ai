import { EMPTY_NEURO } from '../../../shared/demo/clinic'
import { NORMAL_NEURO } from '../../../shared/lib/neuroExam'
import type { BackendScenario, ClinicalInfo, DicomUploadResponse, DocType, Patient } from '../../../shared/types'

export { EMPTY_NEURO }

// Sample-fill buttons are test fixtures (issue #95): only shown when VITE_ENABLE_DEMO_FIXTURES=1.
export const DEMO_FIXTURES_ENABLED = import.meta.env.VITE_ENABLE_DEMO_FIXTURES === '1'

export const STEP_KEYS = ['cases.stepPatient', 'cases.stepClinical', 'cases.stepNeuro', 'cases.stepUpload', 'cases.stepSummary'] as const
export const DOC_TYPES: DocType[] = ['MR Raporu', 'BT Raporu', 'Laboratuvar Sonucu', 'Önceki Rapor']
export const LIMBS = ['Sol ön', 'Sağ ön', 'Sol arka', 'Sağ arka']
export const NOT_ENTERED = 'Girilmedi'
export const CN = ['Baş eğikliği', 'Nistagmus', 'Anizokori', 'Fasiyal paralizi', 'Tehdit refleksi kaybı']

export const EMPTY_PATIENT: Patient = { name: '', species: 'Köpek', breed: '', sex: 'Erkek', neutered: false, age: 0, weight: 0, ownerName: '', ownerPhone: '' }
export const EMPTY_CLINICAL: ClinicalInfo = { complaint: '', onset: 'Akut', course: 'Progresif', history: '', medications: '' }

export type PipelineMode = BackendScenario | 'dicom_metadata'

export const PIPELINE_OPTIONS: { id: PipelineMode; label: string }[] = [
  { id: 'dicom_metadata', label: 'DICOM metadata' },
  { id: 'brain_mri_suspected', label: 'Brain MRI' },
  { id: 'cervical_mri_suspected', label: 'Cervical MRI' },
  { id: 'ct_brain_suspected', label: 'Brain CT' },
  { id: 'xr_thorax_suspected', label: 'Thorax XR' },
  { id: 'document_context', label: 'Doküman / multimodal' },
  { id: 'no_findings', label: 'Bulgu yok' },
  { id: 'unsupported', label: 'Desteklenmeyen' },
  { id: 'model_failure', label: 'Model hatası' },
  { id: 'conflicting', label: 'Çelişen çıktılar' },
]

export const BRAIN_BACKEND_FORM = {
  patient: { name: 'Pax', species: 'Köpek' as const, breed: 'Golden Retriever', sex: 'Erkek' as const, neutered: true, age: 7, weight: 32, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' },
  clinical: {
    complaint: 'Nöbet şüphesi.',
    onset: 'Akut' as const,
    course: 'Progresif' as const,
    history: 'Akut başlangıçlı nöbet öyküsü.',
    medications: 'Yok',
  },
  neuro: { ...NORMAL_NEURO, cranialNervesStatus: 'Bulgu var' as const, cranialNerves: ['Nistagmus'] },
}

export const CERVICAL_BACKEND_FORM = {
  patient: { name: 'Mila', species: 'Köpek' as const, breed: 'Fransız Bulldog', sex: 'Dişi' as const, neutered: true, age: 4, weight: 11, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' },
  clinical: {
    complaint: 'Boyun ağrısı şüphesi.',
    onset: 'Akut' as const,
    course: 'Progresif' as const,
    history: 'Boyun ağrısı ve hareket kısıtlılığı öyküsü.',
    medications: 'Yok',
  },
  neuro: { ...NORMAL_NEURO, hyperesthesia: 'Servikal' as const },
}

export interface UploadFile {
  id: string
  name: string
  type: DocType
  size: string
  /** Browser File blob when user selected a real document (for backend document ingest). */
  file?: File
}

export function guessType(name: string): DocType {
  const n = name.toLocaleLowerCase('tr')
  if (n.includes('mr')) return 'MR Raporu'
  if (n.includes('bt') || n.includes('ct') || n.includes('tomo')) return 'BT Raporu'
  if (n.includes('lab') || n.includes('kan') || n.includes('hemogram') || n.includes('biyokimya')) return 'Laboratuvar Sonucu'
  return 'Önceki Rapor'
}

export function formatFileSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Total instances across all series of an uploaded DICOM study (undefined before upload). */
export function instanceCountOf(preview: DicomUploadResponse | null | undefined): number | undefined {
  return preview?.study?.series.reduce((n, s) => n + s.instances.length, 0)
}
