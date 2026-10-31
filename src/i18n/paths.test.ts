import { describe, expect, it } from 'vitest'
import { localizePath, toCanonicalPath } from './paths'

describe('localizePath', () => {
  it('maps Turkish case workspace to English', () => {
    expect(localizePath('/vakalar/case-abc/calisma', 'en')).toBe('/cases/case-abc/workspace')
  })

  it('keeps Turkish when locale is tr', () => {
    expect(localizePath('/vakalar/case-abc/calisma', 'tr')).toBe('/vakalar/case-abc/calisma')
  })

  it('normalizes English path back to Turkish', () => {
    expect(toCanonicalPath('/cases/case-abc/workspace')).toBe('/vakalar/case-abc/calisma')
  })

  it('preserves query and hash', () => {
    expect(localizePath('/raporlar/case-1?version=2#top', 'en')).toBe('/reports/case-1?version=2#top')
  })

  it('maps public auth routes', () => {
    expect(localizePath('/giris', 'en')).toBe('/login')
    expect(localizePath('/kayit', 'en')).toBe('/register')
    expect(localizePath('/login', 'tr')).toBe('/giris')
  })

  it('leaves root alone', () => {
    expect(localizePath('/', 'en')).toBe('/')
  })
})
