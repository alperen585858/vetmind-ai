import { describe, expect, it } from 'vitest'
import en from './en.json'
import tr from './tr.json'

type Dict = Record<string, unknown>

function has(dict: Dict, key: string): boolean {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false
    node = (node as Dict)[part]
  }
  return typeof node === 'string'
}

// Issue #108 screens: every quoted 'patients.…' key (also inside ternaries) must exist.
const SOURCES = import.meta.glob(
  ['../features/patients/*.tsx', '../features/reports/lib/reportPrint.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('patient / prior-study translations', () => {
  const keys = new Set<string>()
  for (const code of Object.values(SOURCES)) {
    for (const m of code.matchAll(/'(patients\.[a-zA-Z]+(?:\.[a-zA-Z]+)?)'/g)) keys.add(m[1])
  }
  for (const unit of ['day', 'week', 'month', 'year']) keys.add(`patients.ago.${unit}`)

  it('found the keys to check', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(5)
    expect(keys.size).toBeGreaterThan(30)
  })

  it.each([...keys].sort())('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })
})
