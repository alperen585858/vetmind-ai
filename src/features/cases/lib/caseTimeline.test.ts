import { expect, it } from 'vitest'
import { createTranslator } from '../../../i18n'
import { actorName, buildCaseTimeline } from './caseTimeline'

const t = createTranslator('tr')

it('merges status milestones and activity, oldest first, stable on equal times', () => {
  const rows = buildCaseTimeline(
    [
      { date: '2026-11-16T14:32:00Z', label: 'Vaka oluşturuldu', by: 'Sistem' },
      { date: '2026-11-23T12:04:00Z', label: 'AI ön değerlendirmesi oluşturuldu', by: 'Sistem' },
    ],
    [
      { event_id: 'a1', kind: 'clinical_note', actor_subject: 'vet@demo.local', at: '2026-11-20T09:00:00Z' },
      { event_id: 'a2', kind: 'document_attached', actor_subject: 'vet@demo.local', at: '2026-11-20T09:00:00Z' },
    ],
    t,
  )
  expect(rows.map((r) => r.key)).toEqual(['m-0', 'a1', 'a2', 'm-1'])
  expect(rows[1].label).toBe('Klinik not eklendi')
  expect(rows[1].by).toBe('Dr. Elif Kaya')
  expect(rows[0].by).toBe('Sistem')
})

it('names the person instead of "System" where known (#69)', () => {
  expect(actorName('system', t)).toBe('Sistem')
  expect(actorName('Sistem', t)).toBe('Sistem')
  expect(actorName('expert@demo.local', t)).toBe('Prof. Dr. Ahmet Demir')
  expect(actorName('ayse@clinic.test', t)).toBe('ayse@clinic.test')
})

it('keeps an unknown activity kind readable', () => {
  const [row] = buildCaseTimeline([], [{ event_id: 'x', kind: 'future_kind', actor_subject: 'system', at: '2026-11-20T09:00:00Z' }], t)
  expect(row.label).toBe('future_kind')
})
