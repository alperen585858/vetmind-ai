import { describe, expect, it } from 'vitest'
import { passwordProblem, passwordStrength } from './passwordPolicy'

describe('passwordProblem (mirrors backend policy)', () => {
  it.each([
    ['Patiler2026', null],
    ['abcdefg1', null],
    ['şifre2026', null], // Turkish letters count as letters
    ['kısa1', 'tooShort'],
    ['sadeceharf', 'needsLetterAndDigit'],
    ['1234567890', 'needsLetterAndDigit'],
    ['a1'.repeat(61), 'tooLong'],
  ])('%s → %s', (password, expected) => {
    expect(passwordProblem(password)).toBe(expected)
  })
})

describe('passwordStrength', () => {
  it('is 0 for passwords that fail the policy', () => {
    expect(passwordStrength('kısa1')).toBe(0)
  })
  it('grows with length and character variety', () => {
    expect(passwordStrength('abcdefg1')).toBe(1)
    expect(passwordStrength('abcdefghijk1')).toBe(2)
    expect(passwordStrength('Abcdefghij1!')).toBe(3)
  })
})
