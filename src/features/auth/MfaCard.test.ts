import { describe, expect, it } from 'vitest'
import { groupSecret } from './MfaCard'

describe('groupSecret', () => {
  it('splits the base32 key into groups of four for typing by hand', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP')
    expect(groupSecret('ABCDEF')).toBe('ABCD EF')
    expect(groupSecret('')).toBe('')
  })
})
