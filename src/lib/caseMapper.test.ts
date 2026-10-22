import { describe, expect, it } from 'vitest'
import {
  analysisStatusLabel,
  caseStatusFromLifecycle,
  expertReviewLabel,
  summaryToVetCase,
} from './caseMapper'
import type { BackendCaseSummary } from '../types'

describe('caseMapper list/detail helpers', () => {
  it('maps summary fields used by case list filters', () => {
    const summary: BackendCaseSummary = {
      case_id: 'case-abc',
      patient_name: 'Pax',
      species: 'canine',
      breed: 'Golden',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      status: 'awaiting_review',
      created_at: '2026-10-22T10:00:00Z',
      classification_confirmed: true,
      study_instance_uid: '1.2.3',
      series_count: 2,
      instance_count: 12,
    }
    const mapped = summaryToVetCase(summary)
    expect(mapped.patient.name).toBe('Pax')
    expect(mapped.patient.breed).toBe('Golden')
    expect(mapped.modality).toBe('MR')
    expect(mapped.anatomicalRegion).toBe('BRAIN')
    expect(mapped.studyInstanceUid).toBe('1.2.3')
    expect(mapped.seriesCount).toBe(2)
    expect(mapped.status).toBe('uzman_incelemesinde')
    expect(analysisStatusLabel(mapped.status)).toContain('mock')
    expect(expertReviewLabel(mapped.status)).toBe('Bekliyor')
  })

  it('maps reserved classification lifecycle to draft', () => {
    expect(caseStatusFromLifecycle('awaiting_classification_confirmation')).toBe('taslak')
    expect(caseStatusFromLifecycle('failed')).toBe('analiz_basarisiz')
  })
})
