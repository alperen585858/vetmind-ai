import { describe, expect, it } from 'vitest'
import { recordToVetCase } from './caseMapper'
import { localize } from './neuroLocalization'
import {
  NORMAL_NEURO,
  NOT_EVALUATED,
  UNEVALUATED_NEURO,
  cranialNervesText,
  isNeuroExamEmpty,
  neuroItemText,
  neuroPriority,
} from './neuroExam'
import type { BackendCaseRecord } from '../types'

describe('neuro exam "not evaluated" state (#72)', () => {
  it('starts with nothing recorded and is never treated as a normal exam', () => {
    expect(isNeuroExamEmpty(UNEVALUATED_NEURO)).toBe(true)
    expect(isNeuroExamEmpty(NORMAL_NEURO)).toBe(false)
    expect(Object.values(UNEVALUATED_NEURO)).not.toContain('Normal')
    expect(Object.values(UNEVALUATED_NEURO)).not.toContain('Uyanık')
  })

  it('shows "not entered" for unrecorded items and the value otherwise', () => {
    expect(neuroItemText(NOT_EVALUATED, 'Girilmedi')).toBe('Girilmedi')
    expect(neuroItemText('', 'Girilmedi')).toBe('Girilmedi')
    expect(neuroItemText('Parezi', 'Girilmedi')).toBe('Parezi')
    expect(cranialNervesText(UNEVALUATED_NEURO, 'Girilmedi')).toBe('Girilmedi')
    expect(cranialNervesText(NORMAL_NEURO, 'Girilmedi')).toBe('Normal')
    expect(
      cranialNervesText({ ...UNEVALUATED_NEURO, cranialNervesStatus: 'Bulgu var', cranialNerves: ['Nistagmus'] }, '-'),
    ).toBe('Nistagmus')
  })

  it('does not raise or lower priority from unrecorded items', () => {
    expect(neuroPriority(UNEVALUATED_NEURO)).toBe('normal')
    expect(neuroPriority({ ...UNEVALUATED_NEURO, deepPain: 'Yok' })).toBe('stat')
    expect(neuroPriority({ ...UNEVALUATED_NEURO, gait: 'Pleji' })).toBe('urgent')
    expect(neuroPriority({ ...UNEVALUATED_NEURO, consciousness: 'Stupor' })).toBe('high')
  })

  it('gives no localization hint from an unrecorded exam', () => {
    // Before #72 an unknown consciousness counted as "not awake" -> forebrain lesion.
    expect(localize(UNEVALUATED_NEURO)).toBeNull()
    expect(localize({ ...UNEVALUATED_NEURO, hyperesthesia: 'Torakolomber' })?.template).toBe('ivdd')
  })
})

describe('caseMapper neuro exam', () => {
  const base = {
    case_id: 'case-neuro',
    patient_name: 'Pax',
    species: 'canine',
    modality: 'MR',
    anatomical_region: 'THORACOLUMBAR',
    status: 'created',
    created_at: '2026-11-23T10:00:00Z',
    updated_at: '2026-11-23T10:00:00Z',
  }

  it('maps a case without an exam to "not evaluated", not to normal values', () => {
    const mapped = recordToVetCase(base as unknown as BackendCaseRecord)
    expect(isNeuroExamEmpty(mapped.neuro)).toBe(true)
    expect(mapped.neuro.gait).toBe(NOT_EVALUATED)
    expect(mapped.neuro.consciousness).toBe(NOT_EVALUATED)
  })

  it('keeps a partially recorded exam and marks the rest not evaluated', () => {
    const mapped = recordToVetCase({
      ...base,
      clinical_history_structured: { neuro_exam: { gait: 'Parezi', deepPain: 'Var', cranialNervesStatus: NOT_EVALUATED } },
    } as unknown as BackendCaseRecord)
    expect(mapped.neuro.gait).toBe('Parezi')
    expect(mapped.neuro.deepPain).toBe('Var')
    expect(mapped.neuro.reflexPelvic).toBe(NOT_EVALUATED)
    expect(cranialNervesText(mapped.neuro, 'Girilmedi')).toBe('Girilmedi')
  })
})
