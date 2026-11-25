import { expect, it } from 'vitest'
import { autoAnalysisChannel } from './analysisChannel'

it('picks the analysis channel from what was uploaded', () => {
  expect(autoAnalysisChannel('dicom')).toBe('dicom_metadata')
  expect(autoAnalysisChannel('documents')).toBe('document_context')
})
