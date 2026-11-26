import { describe, expect, it } from 'vitest'
import { cleanClinicalHistory, stripNoteStamps } from './displayClean'
import { fmtDateTimeLocal } from './format'

// #68: older records had notes appended to the history as "[<ISO time> · <user>] <text>".
const LEGACY =
  'Arka bacaklarda güçsüzlük.\n\n' +
  '[2026-11-23T12:04:39.984157+00:00 · anonymous] aaa\n\n' +
  '[2026-11-23T13:10:00+00:00 · vet@demo.local] Derin ağrı var.\nİkinci satır.'

describe('legacy clinical note stamps (#68)', () => {
  it('are removed from the history, other text is kept', () => {
    expect(stripNoteStamps(LEGACY)).toBe('Arka bacaklarda güçsüzlük.')
    expect(stripNoteStamps('[2026-11-23T12:04:39+00:00 · x] tek not')).toBe('')
    expect(stripNoteStamps('Normal öykü [köşeli parantez] içerir.')).toBe('Normal öykü [köşeli parantez] içerir.')
    expect(stripNoteStamps(null)).toBe('')
  })

  it('never reach the complaint / history fields', () => {
    expect(cleanClinicalHistory(LEGACY)).toBe('Arka bacaklarda güçsüzlük.')
    expect(cleanClinicalHistory('[2026-11-23T12:04:39+00:00 · anonymous] aaa')).toBe('')
  })
})

describe('fmtDateTimeLocal', () => {
  it('shows an ISO timestamp in local time with a readable month', () => {
    const iso = '2026-11-23T12:04:39.984157+00:00'
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    expect(fmtDateTimeLocal(iso, 'tr')).toBe(`${d.getDate()} Kas 2026 · ${hh}:${mm}`)
    expect(fmtDateTimeLocal(undefined)).toBe('—')
  })
})
