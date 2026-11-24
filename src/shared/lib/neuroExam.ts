import type { NeuroExam, NotEvaluated } from '../types'

/** Stored value for an exam item the vet did not record. */
export const NOT_EVALUATED: NotEvaluated = 'Değerlendirilmedi'

/** Form start state and "no exam on file": nothing is assumed normal. */
export const UNEVALUATED_NEURO: NeuroExam = {
  consciousness: NOT_EVALUATED,
  gait: NOT_EVALUATED,
  limbs: [],
  posturalThoracic: NOT_EVALUATED,
  posturalPelvic: NOT_EVALUATED,
  reflexThoracic: NOT_EVALUATED,
  reflexPelvic: NOT_EVALUATED,
  cranialNervesStatus: NOT_EVALUATED,
  cranialNerves: [],
  deepPain: NOT_EVALUATED,
  hyperesthesia: NOT_EVALUATED,
}

/** What the "Muayene normal" button fills in — an explicit, vet-confirmed normal exam. */
export const NORMAL_NEURO: NeuroExam = {
  consciousness: 'Uyanık',
  gait: 'Normal',
  limbs: [],
  posturalThoracic: 'Normal',
  posturalPelvic: 'Normal',
  reflexThoracic: 'Normal',
  reflexPelvic: 'Normal',
  cranialNervesStatus: 'Normal',
  cranialNerves: [],
  deepPain: 'Var',
  hyperesthesia: 'Yok',
}

const SINGLE_FIELDS = [
  'consciousness',
  'gait',
  'posturalThoracic',
  'posturalPelvic',
  'reflexThoracic',
  'reflexPelvic',
  'cranialNervesStatus',
  'deepPain',
  'hyperesthesia',
] as const

export function isEvaluated(value: string | null | undefined): boolean {
  return Boolean(value && value.trim() && value !== NOT_EVALUATED)
}

/** True when not a single exam item was recorded. */
export function isNeuroExamEmpty(n: NeuroExam): boolean {
  return SINGLE_FIELDS.every((k) => !isEvaluated(n[k])) && n.limbs.length === 0 && n.cranialNerves.length === 0
}

export const ABNORMAL_CONSCIOUSNESS: readonly NeuroExam['consciousness'][] = ['Depresif', 'Stupor', 'Koma']
export const ABNORMAL_GAIT: readonly NeuroExam['gait'][] = ['Ataksi', 'Parezi', 'Pleji']

export type NeuroPriority = 'stat' | 'urgent' | 'high' | 'normal'

/** Triage from recorded findings only; unrecorded items never raise or lower priority. */
export function neuroPriority(n: NeuroExam): NeuroPriority {
  if (n.deepPain === 'Yok') return 'stat'
  if (n.gait === 'Pleji') return 'urgent'
  if (n.gait === 'Parezi' || ABNORMAL_CONSCIOUSNESS.includes(n.consciousness)) return 'high'
  return 'normal'
}

/**
 * Display value for one exam item: recorded value or the "not entered" label.
 * Cranial nerves: abnormal signs joined, "Normal", or the not-entered label.
 */
export function neuroItemText(value: string | null | undefined, notEntered: string): string {
  return isEvaluated(value) ? String(value) : notEntered
}

export function cranialNervesText(n: NeuroExam, notEntered: string): string {
  if (n.cranialNervesStatus === 'Bulgu var' || n.cranialNerves.length) {
    return n.cranialNerves.length ? n.cranialNerves.join(', ') : 'Bulgu var'
  }
  return n.cranialNervesStatus === 'Normal' ? 'Normal' : notEntered
}
