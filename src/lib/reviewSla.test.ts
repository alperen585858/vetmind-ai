import { describe, expect, it } from 'vitest'
import {
  formatSlaRemaining,
  isSlaAttention,
  remainingMs,
  slaHoursForPriority,
  slaTone,
} from './reviewSla'

describe('reviewSla', () => {
  it('maps priority to hours', () => {
    expect(slaHoursForPriority('STAT')).toBe(24)
    expect(slaHoursForPriority('Acil')).toBe(24)
    expect(slaHoursForPriority('Yüksek')).toBe(48)
    expect(slaHoursForPriority('Normal')).toBe(48)
  })

  it('marks overdue and critical tones', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z')
    expect(slaTone('2026-10-29T10:00:00.000Z', now)).toBe('overdue')
    expect(slaTone('2026-10-29T13:00:00.000Z', now)).toBe('critical')
    expect(slaTone('2026-10-29T16:00:00.000Z', now)).toBe('warn')
    expect(slaTone('2026-10-31T12:00:00.000Z', now)).toBe('ok')
  })

  it('formats remaining label', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z')
    expect(formatSlaRemaining('2026-10-29T14:30:00.000Z', now)).toContain('kaldı')
    expect(formatSlaRemaining('2026-10-29T10:00:00.000Z', now)).toContain('gecikme')
    expect(remainingMs(undefined)).toBeNull()
  })

  it('flags attention within 12h', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z')
    expect(isSlaAttention('2026-10-29T20:00:00.000Z', now)).toBe(true)
    expect(isSlaAttention('2026-10-30T12:00:00.000Z', now)).toBe(false)
    expect(isSlaAttention('2026-10-29T10:00:00.000Z', now)).toBe(true)
  })
})
