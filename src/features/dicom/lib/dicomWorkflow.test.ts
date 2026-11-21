import { describe, expect, it } from 'vitest'
import {
  canStartDemoAnalysis,
  classificationConfirmationLabel,
  deriveSelectionPhase,
  phaseFromBackendLifecycle,
  phaseFromJobStatus,
  phaseFromPipelineOutcome,
  validatePatientForm,
} from './dicomWorkflow'

describe('dicomWorkflow', () => {
  it('derives selection phases deterministically', () => {
    expect(
      deriveSelectionPhase({
        fileCount: 0,
        validating: false,
        uploading: false,
        previewReady: false,
        previewBlocked: false,
        confirmed: false,
      }),
    ).toBe('EMPTY')
    expect(
      deriveSelectionPhase({
        fileCount: 2,
        validating: true,
        uploading: false,
        previewReady: false,
        previewBlocked: false,
        confirmed: false,
      }),
    ).toBe('VALIDATING')
    expect(
      deriveSelectionPhase({
        fileCount: 2,
        validating: false,
        uploading: false,
        previewReady: true,
        previewBlocked: false,
        confirmed: false,
      }),
    ).toBe('READY_FOR_CONFIRMATION')
  })

  it('maps backend lifecycle without payment phases', () => {
    expect(phaseFromBackendLifecycle('analyzing')).toBe('PROCESSING')
    expect(phaseFromBackendLifecycle('awaiting_review')).toBe('AWAITING_REVIEW')
    expect(phaseFromBackendLifecycle('created')).toBe('CONFIRMED')
    expect(phaseFromPipelineOutcome('failed')).toBe('FAILED')
  })

  it('maps terminal job statuses including cancel and timeout', () => {
    expect(phaseFromJobStatus('queued')).toBe('QUEUED')
    expect(phaseFromJobStatus('running')).toBe('PROCESSING')
    expect(phaseFromJobStatus('cancel_requested')).toBe('PROCESSING')
    expect(phaseFromJobStatus('completed')).toBe('AWAITING_REVIEW')
    expect(phaseFromJobStatus('failed')).toBe('FAILED')
    expect(phaseFromJobStatus('cancelled')).toBe('FAILED')
    expect(phaseFromJobStatus('timed_out')).toBe('FAILED')
  })

  it('clarifies classification confirmation labels', () => {
    expect(
      classificationConfirmationLabel({ needsConfirmation: true, blocked: false }),
    ).toBe('Sınıflandırma onayı bekleniyor')
    expect(classificationConfirmationLabel({ classificationConfirmed: true })).toBe(
      'Sınıflandırma onaylandı',
    )
    expect(classificationConfirmationLabel({ blocked: true })).toBe('Engellendi')
  })

  it('validates patient form and analysis gate without payment', () => {
    expect(validatePatientForm({ patientName: 'Pax', species: 'Köpek', consent: true })).toEqual({})
    expect(
      canStartDemoAnalysis({
        phase: 'READY_FOR_CONFIRMATION',
        consent: true,
        previewBlocked: false,
        hasIngestOrDemo: true,
      }).ok,
    ).toBe(true)
    expect(
      canStartDemoAnalysis({
        phase: 'FAILED',
        consent: true,
        previewBlocked: false,
        hasIngestOrDemo: true,
      }).ok,
    ).toBe(false)
  })
})
