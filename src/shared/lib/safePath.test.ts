import { describe, expect, it } from 'vitest'
import { safeInternalPath } from './safePath'

describe('safeInternalPath', () => {
  it('keeps in-app paths', () => {
    expect(safeInternalPath('/vakalar/case-1')).toBe('/vakalar/case-1')
    expect(safeInternalPath('/en/cases?x=1#a')).toBe('/en/cases?x=1#a')
  })

  it('blocks external and protocol-relative targets', () => {
    for (const bad of [
      '//evil.com',
      '/\\evil.com',
      '/\\/evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      'evil.com',
      '/\t/evil.com',
      '/vakalar\\..\\evil',
    ]) {
      expect(safeInternalPath(bad)).toBe('/')
    }
  })

  it('uses the fallback for empty input', () => {
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath('', '/kuyruk')).toBe('/kuyruk')
  })
})
