import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../i18n'
import type { BackendSupportThreadSummary } from '../../shared/types'
import { canDeleteThread, filterThreads, groupMessages, initials, localDayKey, roleLabel, type UiMessage } from './messageFormat'

function thread(id: string, extra: Partial<BackendSupportThreadSummary> = {}): BackendSupportThreadSummary {
  return {
    thread_id: id,
    channel: 'radiologist',
    owner_subject: 'vet@clinic.test',
    subject: `Konu ${id}`,
    status: 'open',
    message_count: 1,
    unread_count: 0,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    ...extra,
  }
}

function msg(id: string, author: string, created_at: string): UiMessage {
  return { message_id: id, author_subject: author, author_role: 'vet', body: id, created_at, unread: false }
}

describe('filterThreads', () => {
  const threads = [
    thread('old', { last_message_at: '2026-11-01T10:00:00Z', channel: 'admin' }),
    thread('new', { last_message_at: '2026-11-25T10:00:00Z', unread_count: 2, counterpart_name: 'Dr. Ayşe Kaya' }),
    thread('mid', { last_message_at: '2026-11-10T10:00:00Z', channel: 'clinic', last_message_preview: 'MR sonucu' }),
  ]

  it('sorts newest first', () => {
    expect(filterThreads(threads, 'all', '').map((t) => t.thread_id)).toEqual(['new', 'mid', 'old'])
  })

  it('applies the chip filters', () => {
    expect(filterThreads(threads, 'unread', '').map((t) => t.thread_id)).toEqual(['new'])
    expect(filterThreads(threads, 'admin', '').map((t) => t.thread_id)).toEqual(['old'])
    expect(filterThreads(threads, 'clinic', '').map((t) => t.thread_id)).toEqual(['mid'])
    expect(filterThreads(threads, 'radiologist', '').map((t) => t.thread_id)).toEqual(['new'])
  })

  it('searches subject, preview and names, Turkish case-insensitive', () => {
    expect(filterThreads(threads, 'all', 'ayşe').map((t) => t.thread_id)).toEqual(['new'])
    expect(filterThreads(threads, 'all', '  mr ').map((t) => t.thread_id)).toEqual(['mid'])
    expect(filterThreads(threads, 'all', 'yok-boyle')).toEqual([])
  })
})

describe('canDeleteThread', () => {
  const th = thread('t', { owner_subject: 'vet@clinic.test', recipient_subject: 'rad@clinic.test' })

  it('lets participants and admins delete, nobody else', () => {
    expect(canDeleteThread(th, 'vet', 'vet@clinic.test')).toBe(true)
    expect(canDeleteThread(th, 'expert', 'rad@clinic.test')).toBe(true)
    expect(canDeleteThread(th, 'admin', 'admin@clinic.test')).toBe(true)
    expect(canDeleteThread(th, 'vet', 'other@clinic.test')).toBe(false)
    expect(canDeleteThread(undefined, 'admin', 'admin@clinic.test')).toBe(false)
  })

  it('allows deleting legacy demo rows', () => {
    expect(canDeleteThread(thread('d', { owner_subject: 'anonymous' }), 'vet', 'x@y.z')).toBe(true)
  })
})

describe('message helpers', () => {
  it('builds initials from the first and last word', () => {
    expect(initials('Dr. Ayşe Kaya')).toBe('DK')
    expect(initials('ilker')).toBe('İ')
    expect(initials('  ')).toBe('?')
  })

  it('labels known roles and passes unknown ones through', () => {
    const t = createTranslator('tr')
    expect(roleLabel('expert', t)).toBe(t('messages.roleExpert'))
    expect(roleLabel('robot', t)).toBe('robot')
  })

  it('keeps the raw date for unparseable timestamps', () => {
    expect(localDayKey('not-a-date')).toBe('not-a-date')
  })

  it('groups by day, then by consecutive author', () => {
    const groups = groupMessages([
      msg('a1', 'a', '2026-11-20T09:00:00'),
      msg('a2', 'a', '2026-11-20T09:01:00'),
      msg('b1', 'b', '2026-11-20T09:02:00'),
      msg('a3', 'a', '2026-11-21T09:00:00'),
    ])
    expect(groups.map((g) => g.day)).toEqual(['2026-11-20', '2026-11-21'])
    expect(groups[0].runs.map((r) => [r.author, r.items.length])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    expect(groups[1].runs).toHaveLength(1)
  })
})
