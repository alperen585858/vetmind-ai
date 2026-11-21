import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../i18n'
import { ApiError } from '../api'
import { presentApiError, userErrorMessage } from './apiErrors'

describe('presentApiError', () => {
  const tTr = createTranslator('tr')
  const tEn = createTranslator('en')

  it('maps invalid_credentials code to Turkish', () => {
    const err = new ApiError({
      status: 401,
      code: 'invalid_credentials',
      message: 'Invalid email or password.',
    })
    const presented = presentApiError(err, tTr)
    expect(presented.message).toBe('E-posta veya şifre hatalı.')
    expect(presented.technical).toBe('Invalid email or password.')
  })

  it('maps rate_limited with minutes param', () => {
    const err = new ApiError({
      status: 429,
      code: 'rate_limited',
      message: 'Too many attempts. Try again in 15 min.',
      params: { minutes: 15 },
    })
    expect(presentApiError(err, tTr).message).toContain('15')
    expect(presentApiError(err, tEn).message).toContain('15')
  })

  it('infers code from legacy English message', () => {
    const presented = presentApiError(new Error('Invalid email or password.'), tTr)
    expect(presented.code).toBe('invalid_credentials')
    expect(presented.message).toBe('E-posta veya şifre hatalı.')
  })

  it('uses generic message for unknown English detail', () => {
    const presented = presentApiError(new Error('Some obscure backend failure XYZ'), tTr)
    expect(presented.message).toBe(tTr('apiErrors.unexpected'))
    expect(presented.technical).toContain('XYZ')
    expect(userErrorMessage(new Error('Some obscure backend failure XYZ'), tTr)).toContain('XYZ')
  })
})
