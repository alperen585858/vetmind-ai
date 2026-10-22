import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollingCancelledError, analyzeCaseAsyncAndWait } from './backend'

describe('analyzeCaseAsyncAndWait polling cancel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws PollingCancelledError when signal aborts (does not imply backend cancel)', async () => {
    const controller = new AbortController()
    let pollCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/analyze/async')) {
          return new Response(JSON.stringify({ job_id: 'job-1', status: 'queued', case_id: 'case-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/jobs/')) {
          pollCount += 1
          // After first status read, abort client poll before next sleep/poll.
          if (pollCount === 1) controller.abort()
          return new Response(
            JSON.stringify({
              job_id: 'job-1',
              case_id: 'case-1',
              status: 'running',
              outcome: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    await expect(
      analyzeCaseAsyncAndWait('case-1', { signal: controller.signal, intervalMs: 10, timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(PollingCancelledError)

    expect(pollCount).toBe(1)
  })

  it('treats cancelled as a terminal job status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/analyze/async')) {
          return new Response(JSON.stringify({ job_id: 'job-2', status: 'queued', case_id: 'case-2' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/jobs/')) {
          return new Response(
            JSON.stringify({
              job_id: 'job-2',
              case_id: 'case-2',
              status: 'cancelled',
              outcome: null,
              error_message: 'Cancelled while queued.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/findings') || url.includes('/report')) {
          return new Response('null', { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('/cases/case-2')) {
          return new Response(
            JSON.stringify({
              case_id: 'case-2',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              status: 'failed',
              patient_name: 'Synth',
              species: 'canine',
              modality: 'MR',
              anatomical_region: 'BRAIN',
              classification_confirmed: true,
              study: { dicom_available: false },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    const result = await analyzeCaseAsyncAndWait('case-2', { intervalMs: 5, timeoutMs: 2000 })
    expect(result.job.status).toBe('cancelled')
    expect(result.outcome).toBe('failed')
  })
})
