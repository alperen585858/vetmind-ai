import type { BackendDraftReport, BackendFindings, BackendPipelineResult } from '../../types'
import { getBackendCase } from './cases'
import { ApiError, PollingCancelledError, request, sleep, throwIfAborted } from './client'
import { submitBackendReview } from './reports'

/** Enqueue background analyze and poll until completed/failed.
 *
 * `signal` aborts **client polling only** by default — it does not cancel the backend job.
 * Pass `cancelBackendOnAbort: true` to also POST `/jobs/{id}/cancel` when the signal aborts
 * (or when {@link PollingCancelledError} is thrown after enqueue).
 * Catch {@link PollingCancelledError} vs network/backend failures separately.
 */
export async function analyzeCaseAsyncAndWait(
  caseId: string,
  opts?: {
    timeoutMs?: number
    intervalMs?: number
    signal?: AbortSignal
    /** Fired once the async job is enqueued (before polling). */
    onJobEnqueued?: (jobId: string) => void
    /** If true, aborting `signal` also requests cooperative backend cancel. */
    cancelBackendOnAbort?: boolean
  },
): Promise<BackendPipelineResult> {
  // Real LLM drafts (draft + repair + differentials + verifier) take ~1 min on a laptop;
  // the backend job keeps running regardless, so wait long and poll gently.
  const timeoutMs = opts?.timeoutMs ?? 300_000
  let intervalMs = opts?.intervalMs ?? 120
  const maxIntervalMs = Math.max(intervalMs, 1_500)
  const signal = opts?.signal
  let jobId: string | undefined
  const cancelBackendIfNeeded = async () => {
    if (!opts?.cancelBackendOnAbort || !jobId) return
    try {
      await requestCancelAnalysisJob(jobId)
    } catch {
      /* best-effort — poll abort already happened */
    }
  }
  try {
    throwIfAborted(signal)
    const job = await request<{ job_id: string; status: string; case_id: string }>(
      `/cases/${caseId}/analyze/async`,
      { method: 'POST', signal },
    )
    jobId = job.job_id
    opts?.onJobEnqueued?.(job.job_id)
    const deadline = Date.now() + timeoutMs
    let status = job.status
    while (Date.now() < deadline) {
      throwIfAborted(signal, job.job_id)
      const polled = await request<{
        job_id: string
        case_id: string
        status: string
        outcome: BackendPipelineResult['outcome'] | null
        error_message?: string | null
        routed_model_ids?: string[]
        route_reason?: string | null
      }>(`/jobs/${job.job_id}`, { signal })
      status = polled.status
      const terminal =
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'timed_out'
      if (terminal) {
        throwIfAborted(signal, job.job_id)
        if (status === 'failed' || status === 'cancelled' || status === 'timed_out') {
          // Findings/report are often absent on failed jobs — never let those 404s mask the job error.
          void request<BackendFindings | null>(`/cases/${caseId}/findings`, { signal }).catch(() => null)
          const detail =
            (polled.error_message && String(polled.error_message).trim()) ||
            `Async analyze ended with status=${status}.`
          throw new ApiError({
            status: status === 'timed_out' ? 504 : 502,
            message: detail,
            code: status === 'timed_out' ? 'analyze_job_timed_out' : 'analyze_job_failed',
            detail: polled,
          })
        }
        // Completed: allow missing findings/report (404) but surface auth/server failures.
        const softGet = async <T,>(path: string): Promise<T | null> => {
          try {
            return await request<T>(path, { signal })
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) return null
            throw err
          }
        }
        const [findings, report, caseRecord] = await Promise.all([
          softGet<BackendFindings | null>(`/cases/${caseId}/findings`),
          softGet<BackendDraftReport | null>(`/cases/${caseId}/report`),
          (async () => {
            let lastErr: unknown
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                return await getBackendCase(caseId, signal)
              } catch (err) {
                lastErr = err
                await sleep(150 * (attempt + 1), signal)
              }
            }
            throw lastErr instanceof Error ? lastErr : new Error('Case not found.')
          })(),
        ])
        const outcome =
          (polled.outcome as BackendPipelineResult['outcome'] | null) ??
          (caseRecord?.status === 'manual_review' ? 'unsupported' : 'success')
        return {
          outcome,
          job: {
            job_id: polled.job_id,
            case_id: polled.case_id,
            status: polled.status,
            routed_model_ids: polled.routed_model_ids ?? [],
            route_reason: polled.route_reason,
            error_message: polled.error_message,
          },
          findings,
          report,
          messages: [
            'Async analyze completed.',
            opts?.cancelBackendOnAbort
              ? 'Client abort also requests backend job cancel when enabled.'
              : 'Client poll abort does not cancel the backend job.',
          ],
        }
      }
      await sleep(intervalMs, signal)
      intervalMs = Math.min(maxIntervalMs, Math.round(intervalMs * 1.5))
    }
    throw new ApiError({
      status: 504,
      message: `Analyze job ${job.job_id} timed out (last status=${status}).`,
      code: 'analyze_job_timed_out',
      detail: { job_id: job.job_id, status },
    })
  } catch (err) {
    if (err instanceof PollingCancelledError) {
      await cancelBackendIfNeeded()
      throw err
    }
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') {
      await cancelBackendIfNeeded()
      throw new PollingCancelledError('Job polling cancelled by client', jobId)
    }
    throw err
  }
}

/** Enqueue background analyze and return immediately (no polling). */
export async function enqueueAnalyzeCase(
  caseId: string,
  opts?: { signal?: AbortSignal },
): Promise<BackendAnalysisJob> {
  return request<BackendAnalysisJob>(`/cases/${caseId}/analyze/async`, {
    method: 'POST',
    signal: opts?.signal,
  })
}

export type BackendAnalysisJob = {
  job_id: string
  case_id: string
  status: string
  outcome?: string | null
  error_message?: string | null
  routed_model_ids?: string[]
  routed_model_versions?: string[]
  route_reason?: string | null
  analysis_mode?: string
  cancel_requested?: boolean
  timeout_s?: number | null
  idempotency_key?: string | null
  /** Checkpoint stage from orchestrator — not a time estimate. */
  pipeline_stage?: string | null
  /** 0–100 from completed pipeline stages only. */
  progress_pct?: number
  stage_label?: string | null
  vision_adapter_index?: number | null
  vision_adapter_total?: number | null
  /** VLM multi-batch progress (visual frames only — not metadata inventory). */
  vision_batch_index?: number | null
  vision_batch_total?: number | null
  vision_frames_detected?: number | null
  vision_frames_decoded?: number | null
  vision_frames_analyzed?: number | null
  vision_series_total?: number | null
  vision_series_done?: number | null
  vision_analysis_scope?: string | null
  vision_detail?: string | null
}

export async function getAnalysisJob(jobId: string, signal?: AbortSignal): Promise<BackendAnalysisJob> {
  return request<BackendAnalysisJob>(`/jobs/${jobId}`, { signal })
}

export async function requestCancelAnalysisJob(jobId: string): Promise<BackendAnalysisJob> {
  return request<BackendAnalysisJob>(`/jobs/${jobId}/cancel`, { method: 'POST' })
}

/** Fetch a completed synchronous analyze run (no background queue). */
export async function getJob(jobId: string) {
  return request<{ job_id: string; status: string; outcome: string | null; error_message: string | null }>(`/jobs/${jobId}`)
}

/**
 * Full imaging+LLM re-analyze for an existing case (including ones that already have a draft/report).
 * Approved / immutable reports cannot be analyzed in place — opens a revision fork first when requested.
 */
export async function resendCaseToAI(
  caseId: string,
  opts?: {
    signal?: AbortSignal
    cancelBackendOnAbort?: boolean
    onJobEnqueued?: (jobId: string) => void
    /** When true, POST request_revision before analyze (required for approved/immutable). */
    openRevisionFirst?: boolean
    revisionComment?: string
  },
): Promise<BackendPipelineResult> {
  if (opts?.openRevisionFirst) {
    await submitBackendReview(caseId, {
      action: 'request_revision',
      comment:
        opts.revisionComment ??
        'AI tam pipeline yeniden analizi için yeni düzenlenebilir sürüm açıldı. Önceki onaylı sürüm geçmişte korunur.',
      reason_codes: ['report_quality'],
    })
  }
  return analyzeCaseAsyncAndWait(caseId, {
    signal: opts?.signal,
    cancelBackendOnAbort: opts?.cancelBackendOnAbort,
    onJobEnqueued: opts?.onJobEnqueued,
  })
}
