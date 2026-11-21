import { describe, expect, it } from 'vitest'
import en from './en.json'
import tr from './tr.json'
import { ROLE_LABELS, USERS } from '../shared/demo/users'

const ROLES = ['vet', 'expert', 'owner', 'clinic_owner', 'admin'] as const

type RoleDict = Record<string, string>

describe('role names are the same everywhere (issue #46)', () => {
  it.each([
    ['tr', tr],
    ['en', en],
  ])('%s: role menu (roles) and profile badge (roleTitles) match', (_lang, dict) => {
    const roles = dict.roles as RoleDict
    const titles = dict.roleTitles as RoleDict
    for (const role of ROLES) {
      expect(titles[role], role).toBe(roles[role])
    }
  })

  it('demo users and ROLE_LABELS use the Turkish role names', () => {
    const roles = tr.roles as RoleDict
    for (const role of ROLES) {
      expect(USERS[role].title, role).toBe(roles[role])
      expect(ROLE_LABELS[role], role).toBe(roles[role])
    }
  })

  it('the expert is a radiologist, not a neurologist', () => {
    expect((tr.roles as RoleDict).expert).toBe('Uzman Veteriner Radyolog')
    expect((en.roles as RoleDict).expert).toBe('Veterinary Radiologist')
  })
})
