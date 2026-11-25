import type { BackendAnatomicalRegion, BackendModality, BackendSpecies } from './dicom'

/** Clinic patient (animal) record, issue #108. */
export interface BackendPatient {
  patient_id: string
  clinic_id?: string | null
  owner_subject?: string | null
  name: string
  species: BackendSpecies
  breed?: string | null
  sex?: string | null
  birth_date?: string | null
  microchip?: string | null
  clinic_patient_no?: string | null
  dicom_patient_ids: string[]
  merged_into?: string | null
  created_at: string
  updated_at: string
}

export interface BackendPatientCreate {
  name: string
  species: BackendSpecies
  breed?: string | null
  sex?: string | null
  birth_date?: string | null
  microchip?: string | null
  clinic_patient_no?: string | null
}

/** One earlier (or later) study of the same patient. */
export interface BackendPriorStudy {
  case_id: string
  created_at: string
  /** DICOM StudyDate (YYYYMMDD) when known. */
  study_date?: string | null
  modality: BackendModality
  anatomical_region: BackendAnatomicalRegion
  status: string
  /** Same modality and region as the case being read. */
  comparable: boolean
  has_dicom: boolean
  approved_report_version?: number | null
  impression_excerpt?: string | null
}

export interface BackendPatientMatch {
  patient: BackendPatient
  reason: 'dicom_patient_id' | 'name_species'
}

export interface BackendCasePriorStudies {
  /** Null until the case is linked to a patient. */
  patient: BackendPatient | null
  studies: BackendPriorStudy[]
  suggestions: BackendPatientMatch[]
}

export interface BackendPatientStudies {
  patient: BackendPatient
  studies: BackendPriorStudy[]
}

/** "Change since the prior study" report section. */
export interface BackendReportComparison {
  prior_case_id?: string | null
  prior_study_date?: string | null
  prior_report_version?: number | null
  text: string
  new_finding_codes: string[]
  persisting_finding_codes: string[]
  resolved_finding_codes: string[]
  citation_map: Record<string, string>
  source: 'template' | 'expert'
}
