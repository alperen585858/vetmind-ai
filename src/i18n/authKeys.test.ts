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

// Files added or rewritten for issue #31 step 6.
const FILES = [
  'pages/Register.tsx',
  'pages/Login.tsx',
  'pages/ForgotPassword.tsx',
  'pages/ResetPassword.tsx',
  'pages/AdminUsers.tsx',
  'components/ChangePasswordCard.tsx',
  'components/PasswordStrength.tsx',
  'components/AuthCard.tsx',
]

const SOURCES = import.meta.glob(['../pages/*.tsx', '../components/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('auth pages translations', () => {
  const keys = new Set<string>()
  for (const file of FILES) {
    const code = SOURCES[`../${file}`]
    if (code === undefined) throw new Error(`missing source ${file}`)
    for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z0-9.]+)'/g)) keys.add(m[1])
  }
  // Keys built at runtime.
  for (const i of [0, 1, 2, 3]) keys.add(`auth.strength${i}`)
  for (const r of ['owner', 'vet']) keys.add(`roles.${r}`)

  it('found the keys to check', () => {
    expect(keys.size).toBeGreaterThan(30)
  })

  it.each([...keys].sort())('%s exists in tr and en', (key) => {
    expect(has(tr as Dict, key)).toBe(true)
    expect(has(en as Dict, key)).toBe(true)
  })
})
