import { describe, expect, it } from 'vitest'
import { groupMessages, initials, localDayKey, type UiMessage } from './messageGroups'

// #133: message list grouping and avatars.
const msg = (id: string, author: string, at: string): UiMessage => ({
  message_id: id,
  author_subject: author,
  author_role: author.startsWith('vet') ? 'vet' : 'support',
  body: id,
  created_at: at,
  unread: false,
})

describe('initials', () => {
  it('first and last word, punctuation ignored, Turkish upper case', () => {
    expect(initials('Dr. Ayşe Kaya')).toBe('DK')
    expect(initials('ilknur')).toBe('İ')
    expect(initials('  ')).toBe('?')
  })
})

describe('groupMessages', () => {
  it('groups by local day, then by consecutive author', () => {
    const a = new Date(2026, 10, 27, 9, 0).toISOString()
    const b = new Date(2026, 10, 27, 9, 5).toISOString()
    const c = new Date(2026, 10, 27, 9, 7).toISOString()
    const d = new Date(2026, 10, 28, 8, 0).toISOString()
    const groups = groupMessages([msg('1', 'vet@x', a), msg('2', 'vet@x', b), msg('3', 'support@x', c), msg('4', 'vet@x', d)])
    expect(groups.map((g) => g.day)).toEqual(['2026-11-27', '2026-11-28'])
    expect(groups[0].runs.map((r) => [r.author, r.items.length])).toEqual([
      ['vet@x', 2],
      ['support@x', 1],
    ])
    expect(groups[1].runs[0].items[0].message_id).toBe('4')
  })

  it('a bad timestamp does not throw', () => {
    expect(localDayKey('not-a-date-xyz')).toBe('not-a-date')
    expect(groupMessages([])).toEqual([])
  })
})
