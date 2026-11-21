export type BackendScenario =
  | 'brain_mri_suspected'
  | 'cervical_mri_suspected'
  | 'ct_brain_suspected'
  | 'xr_thorax_suspected'
  | 'document_context'
  | 'no_findings'
  | 'unsupported'
  | 'model_failure'
  | 'conflicting'

export type DicomDemoKind = 'brain_mri' | 'cervical_mri' | 'thoracolumbar_mri' | 'brain_ct' | 'thorax_xr'

export type BackendSpecies = 'canine' | 'feline' | 'other'

export type BackendModality = 'MR' | 'CT' | 'XR' | 'OTHER'
export type BackendAnatomicalRegion = 'BRAIN' | 'CERVICAL' | 'THORAX' | 'THORACOLUMBAR' | 'OTHER' | 'UNKNOWN'
export type ClassificationConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface DicomValidationIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  filename?: string | null
  sop_instance_uid?: string | null
}

export interface ClassificationSignal {
  name: string
  modality?: BackendModality | null
  anatomical_region?: BackendAnatomicalRegion | null
  confidence: ClassificationConfidence
  note: string
  source_kind?: string
}

export interface ClassificationSuggestion {
  suggested_modality: BackendModality
  suggested_anatomical_region: BackendAnatomicalRegion
  confidence: ClassificationConfidence
  needs_confirmation: boolean
  rationale: string[]
  source_tags: Record<string, string | null>
  note: string
  signals?: ClassificationSignal[]
  disagreement?: boolean
}

export interface DicomStudyMeta {
  schema_version: string
  study_instance_uid: string
  study_description?: string | null
  accession_number?: string | null
  series: {
    series_instance_uid: string
    modality?: BackendModality | null
    series_description?: string | null
    body_part_examined?: string | null
    instances: { sop_instance_uid: string; filename?: string | null; has_pixel_data: boolean; pixel_data_analyzed: boolean }[]
  }[]
}

export interface DicomUploadResponse {
  ingest_id: string
  blocked: boolean
  block_reason?: string | null
  issues: DicomValidationIssue[]
  study: DicomStudyMeta | null
  classification: ClassificationSuggestion | null
  quarantine_dir?: string | null
  quarantined_file_count?: number
  note: string
}

export interface DicomQuarantineFileRef {
  original_filename: string
  stored_filename: string
  relative_path: string
  size_bytes: number
  sha256: string
  content_kind: string
}

/** Full ingest record from GET /dicom/ingestions/{id} (owner-readable when owned). */
export interface DicomIngestionRecord {
  ingest_id: string
  created_at: string
  patient_name: string
  species: string
  breed?: string | null
  clinical_history?: string | null
  referring_clinic?: string | null
  owner_subject?: string | null
  clinic_id?: string | null
  study: DicomStudyMeta | null
  issues: DicomValidationIssue[]
  classification: ClassificationSuggestion | null
  accepted: boolean
  case_id?: string | null
  blocked: boolean
  block_reason?: string | null
  quarantine_dir?: string | null
  quarantined_files: DicomQuarantineFileRef[]
}
