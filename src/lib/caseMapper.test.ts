import { describe, expect, it } from 'vitest'
import {
  analysisStatusLabel,
  caseStatusFromLifecycle,
  expertReviewLabel,
  recordToVetCase,
  summaryToVetCase,
} from './caseMapper'
import type { BackendCaseRecord, BackendCaseSummary } from '../types'

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
    expect(analysisStatusLabel(mapped.status)).toMatch(/Tamamlandı|mock|analiz/i)
    expect(expertReviewLabel(mapped.status)).toBe('Bekliyor')
  })

  it('maps reserved classification lifecycle to draft', () => {
    expect(caseStatusFromLifecycle('awaiting_classification_confirmation')).toBe('taslak')
    expect(caseStatusFromLifecycle('failed')).toBe('analiz_basarisiz')
  })

  it('hydrates neuro exam and demographics from structured clinical history', () => {
    const record = {
      case_id: 'case-neuro',
      patient_name: 'Rex',
      species: 'canine',
      breed: 'Shepherd',
      patient_age_years: 5,
      modality: 'MR',
      anatomical_region: 'BRAIN',
      status: 'awaiting_review',
      clinical_history: 'Ataksi',
      clinical_history_structured: {
        complaint: 'Ataksi',
        sex: 'Dişi',
        weight_kg: 22.5,
        neutered: true,
        neuro_exam: {
          consciousness: 'Depresif',
          gait: 'Ataksi',
          limbs: ['Sol arka'],
          deepPain: 'Var',
          hyperesthesia: 'Servikal',
          posturalThoracic: 'Azalmış',
          posturalPelvic: 'Azalmış',
          reflexThoracic: 'Azalmış',
          reflexPelvic: 'Azalmış',
          cranialNerves: [],
        },
      },
      created_at: '2026-10-22T10:00:00Z',
      updated_at: '2026-10-22T10:00:00Z',
      classification_confirmed: true,
    } as BackendCaseRecord
    const mapped = recordToVetCase(record)
    expect(mapped.patient.sex).toBe('Dişi')
    expect(mapped.patient.weight).toBe(22.5)
    expect(mapped.patient.neutered).toBe(true)
    expect(mapped.neuro.gait).toBe('Ataksi')
    expect(mapped.neuro.consciousness).toBe('Depresif')
    expect(mapped.neuro.limbs).toEqual(['Sol arka'])
  })
})
