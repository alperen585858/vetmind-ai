import { describe, expect, it, vi } from 'vitest'
import { loadCaseStudy, type CaseStudyDeps } from './caseStudy'

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'application/dicom' })

function deps(overrides: Partial<CaseStudyDeps> = {}): CaseStudyDeps {
  return {
    loadCached: vi.fn(async () => null),
    fetchBackend: vi.fn(async () => []),
    fetchDemo: vi.fn(async () => [file('demo.dcm')]),
    cache: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('loadCaseStudy', () => {
  it('shows the cached upload first and does not rewrite the cache', async () => {
    const d = deps({ loadCached: vi.fn(async () => [file('a.dcm')]) })
    const out = await loadCaseStudy({ caseKey: 'case-1', onBackend: true }, d)
    expect(out.kind).toBe('cached')
    expect(d.fetchBackend).not.toHaveBeenCalled()
    expect(d.cache).not.toHaveBeenCalled()
  })

  it('caches only the backend copy of the case study', async () => {
    const backend = [file('b1.dcm'), file('b2.dcm')]
    const d = deps({ fetchBackend: vi.fn(async () => backend) })
    const out = await loadCaseStudy({ caseKey: 'case-1', onBackend: true }, d)
    expect(out).toEqual({ kind: 'backend', files: backend })
    expect(d.cache).toHaveBeenCalledWith('case-1', backend)
  })

  it('never fetches demo images for a case that was not created from one', async () => {
    const d = deps()
    const out = await loadCaseStudy({ caseKey: 'case-1', onBackend: true }, d)
    expect(out.kind).toBe('none')
    expect(d.fetchDemo).not.toHaveBeenCalled()
    expect(d.cache).not.toHaveBeenCalled()
  })

  it('throws a backend failure so the viewer can offer a retry', async () => {
    const d = deps({ fetchBackend: vi.fn(async () => { throw new Error('down') }) })
    await expect(loadCaseStudy({ caseKey: 'case-1', onBackend: true }, d)).rejects.toThrow('down')
    expect(d.fetchDemo).not.toHaveBeenCalled()
  })

  it('shows the fixture a demo case was created from, without caching it', async () => {
    const d = deps({ fetchBackend: vi.fn(async () => { throw new Error('down') }) })
    const out = await loadCaseStudy({ caseKey: 'case-1', onBackend: true, demoKind: 'thorax_xr' }, d)
    expect(out.kind).toBe('demoCase')
    expect(d.fetchDemo).toHaveBeenCalledWith('thorax_xr', 1)
    expect(d.cache).not.toHaveBeenCalled()
  })

  it('skips the backend for a case that only exists in this browser', async () => {
    const d = deps()
    await loadCaseStudy({ caseKey: 'local-1', onBackend: false }, d)
    expect(d.fetchBackend).not.toHaveBeenCalled()
  })
})
