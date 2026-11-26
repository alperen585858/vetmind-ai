import { describe, expect, it } from 'vitest'
import en from '../../i18n/en.json'
import tr from '../../i18n/tr.json'
import { sameRoles } from './MfaPolicyCard'

type Dict = Record<string, unknown>
const has = (dict: Dict, key: string) =>
  typeof key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Dict)[p] : undefined), dict) === 'string'

describe('MfaPolicyCard', () => {
  it('compares role sets regardless of order', () => {
    expect(sameRoles(['expert', 'admin'], ['admin', 'expert'])).toBe(true)
    expect(sameRoles(['expert'], ['expert', 'vet'])).toBe(false)
    expect(sameRoles([], [])).toBe(true)
  })

  const keys = [
    ...['admin', 'env', 'default'].map((s) => `admin.mfaPolicySource.${s}`),
    ...['admin', 'expert', 'vet', 'clinic_owner'].map((r) => `roles.${r}`),
  ]
  it.each(keys)('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })
})
