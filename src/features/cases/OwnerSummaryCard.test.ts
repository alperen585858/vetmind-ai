import { describe, expect, it } from 'vitest'
import en from '../../i18n/en.json'
import tr from '../../i18n/tr.json'
import { warningKey } from './OwnerSummaryCard'

type Dict = Record<string, unknown>
const has = (dict: Dict, key: string) =>
  typeof key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Dict)[p] : undefined), dict) === 'string'

const SOURCE = Object.values(
  import.meta.glob('./OwnerSummaryCard.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0]

describe('OwnerSummaryCard', () => {
  it('maps rejected-model warnings to their reason', () => {
    expect(warningKey('model_text_rejected:dose')).toBe('dose')
    expect(warningKey('certainty')).toBe('certainty')
  })

  const keys = new Set<string>()
  for (const m of SOURCE.matchAll(/'(ownerSummary\.[a-zA-Z.]+[a-zA-Z])'/g)) keys.add(m[1])
  for (const w of ['dose', 'certainty', 'prognosis', 'empty']) keys.add(`ownerSummary.warning.${w}`)

  it('found the keys', () => expect(keys.size).toBeGreaterThan(20))
  it.each([...keys].sort())('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })
})
