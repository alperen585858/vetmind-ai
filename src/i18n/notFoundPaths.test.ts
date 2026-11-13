import { describe, expect, it } from 'vitest'
import { isKnownAppPath } from './paths'

describe('isKnownAppPath (404 vs redirect, issue #28)', () => {
  it('knows app and public routes in both languages, with params', () => {
    for (const p of ['/', '/vakalar', '/cases', '/vakalar/case-123/calisma', '/cases/case-1/workspace', '/giris', '/login', '/ai-dersleri?x=1']) {
      expect(isKnownAppPath(p)).toBe(true)
    }
  })

  it('treats unknown paths as 404', () => {
    for (const p of ['/olmayan-sayfa', '/vakalar/case-1/olmayan', '/admin/secret', '/en/cases']) {
      expect(isKnownAppPath(p)).toBe(false)
    }
  })
})
