import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportTrainingDataset } from './backend'

describe('exportTrainingDataset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts verified_only export and returns manifest summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body || '{}'))
        expect(body.dataset_version).toBe('unit-1')
        expect(body.policy).toBe('verified_only')
        expect(body.include_splits).toBe(true)
        return new Response(
          JSON.stringify({
            manifest: {
              export_id: 'exp-1',
              dataset_version: 'unit-1',
              policy: 'verified_only',
              row_count: 2,
              split_counts: { train: 1, val: 1, test: 0 },
            },
            jsonl: '{"evidence_id":"e1"}\n{"evidence_id":"e2"}\n',
            rows: [{ evidence_id: 'e1' }, { evidence_id: 'e2' }],
            splits: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const res = await exportTrainingDataset({ dataset_version: 'unit-1' })
    expect(res.manifest.export_id).toBe('exp-1')
    expect(res.manifest.row_count).toBe(2)
    expect(res.jsonl).toContain('e1')
  })
})
