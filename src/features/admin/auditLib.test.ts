import { describe, expect, it } from 'vitest'
import en from '../../i18n/en.json'
import tr from '../../i18n/tr.json'
import { NAMED_EVENTS, eventKey, eventLabel, filtersFromSearch, filtersToSearch, toApiFilters } from './auditLib'

type Dict = Record<string, unknown>
const has = (dict: Dict, key: string) =>
  typeof key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Dict)[p] : undefined), dict) === 'string'

describe('auditLib', () => {
  it('names known events and passes unknown ones through', () => {
    const t = (k: string) => `T(${k})`
    expect(eventLabel(t, 'auth.login')).toBe('T(security.events.auth_login)')
    expect(eventLabel(t, 'something.new')).toBe('something.new')
  })

  it.each(NAMED_EVENTS.map((e) => eventKey(e)))('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })

  it('round-trips filters through the address bar and drops empty ones', () => {
    const f = { event_type: 'auth.', actor: 'vet@', outcome: 'denied' as const, since: '2026-11-01', until: '' }
    const qs = filtersToSearch(f)
    expect(qs.toString()).toBe('olay=auth.&kisi=vet%40&sonuc=denied&baslangic=2026-11-01')
    expect(filtersFromSearch(qs)).toEqual({ ...f, until: '' })
    expect(filtersFromSearch(new URLSearchParams('sonuc=hacked')).outcome).toBe('')
  })

  it('turns date inputs into instants and makes "until" cover the whole day', () => {
    const api = toApiFilters({ since: '2026-11-01', until: '2026-11-01', actor: '  ', outcome: '' })
    expect(new Date(api.until!).getTime() - new Date(api.since!).getTime()).toBe(24 * 3600 * 1000)
    expect(api.actor).toBeUndefined()
    expect(api.outcome).toBeUndefined()
    expect(toApiFilters({ since: 'yesterday' }).since).toBeUndefined()
  })
})

const PAGE = Object.values(
  import.meta.glob('./SecurityAudit.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0]

describe('SecurityAudit translations', () => {
  const keys = new Set<string>()
  for (const m of PAGE.matchAll(/'((?:security|nav)\.[a-zA-Z_.]+[a-zA-Z_])'/g)) keys.add(m[1])
  for (const kind of ['failed_logins', 'rate_limited', 'refresh_reuse']) keys.add(`security.suspicious.${kind}`)
  for (const o of ['success', 'denied', 'error', 'info']) keys.add(`security.outcome.${o}`)
  for (const g of ['all', 'auth_login', 'auth_all', 'admin_all', 'case_all', 'patient_all', 'dicom_all', 'report_link_all']) {
    keys.add(`security.groups.${g}`)
  }
  keys.add('nav.security')

  it('found the page keys', () => expect(keys.size).toBeGreaterThan(35))
  it.each([...keys].sort())('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })
})
