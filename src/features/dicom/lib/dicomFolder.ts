/**
 * DICOM folder selection lives in shared. Re-export it here so the dicom
 * feature keeps a local entry, including the viewer frame cap.
 */
export { MAX_VIEWER_FRAMES } from '../../../shared/lib/dicomLimits'
export type { FileRejectReason, RejectedFile, SelectionValidation } from '../../../shared/lib/dicomFolder'
export {
  MAX_DICOM_FILE_BYTES,
  MAX_DICOM_FILES,
  MAX_DICOM_TOTAL_BYTES,
  capFiles,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
  displayPath,
  fileIdentityKey,
  filterDicomFiles,
  isLikelyDicomFile,
  rejectReasonLabel,
  sniffDicomPart10,
  validateDicomSelectionAsync,
  validateDicomSelectionSync,
} from '../../../shared/lib/dicomFolder'
