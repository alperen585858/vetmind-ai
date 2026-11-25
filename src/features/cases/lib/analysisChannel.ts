/**
 * #80: vets do not pick an analysis channel; it follows what they upload.
 * DICOM → DICOM metadata path (routed to a model from the confirmed modality/region);
 * documents only → document / multimodal path.
 */
export type IntakeMode = 'documents' | 'dicom'

export function autoAnalysisChannel(intake: IntakeMode): 'dicom_metadata' | 'document_context' {
  return intake === 'dicom' ? 'dicom_metadata' : 'document_context'
}
