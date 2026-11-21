/** Display progress for the Processing page: backend checkpoint % + time-based ETA. */

export function estimateAnalysisDurationMs(instanceCount: number | null | undefined): number {
  const n = Math.max(1, instanceCount ?? 1)
  const batches = Math.max(1, Math.ceil(n / 8))
  // prep + VLM batches + LLM draft/repair (observed ~25s for 33 frames VLM + ~45–60s report)
  return 12_000 + batches * 7_000 + 50_000
}

/**
 * Smooth bar that never goes backwards, tracks real job %, and fills toward ETA.
 * Caps at 97% until the job is terminal so we don't claim 100% early.
 */
export function displayAnalysisProgress(input: {
  backendPct: number | null | undefined
  startedAtMs: number | null | undefined
  estimatedMs: number | null | undefined
  instanceCount?: number | null
  status: string | undefined
  nowMs?: number
}): number {
  const status = input.status
  if (status === 'completed') return 100
  if (status === 'failed' || status === 'cancelled' || status === 'timed_out') {
    return Math.max(0, Math.min(100, input.backendPct ?? 0))
  }

  const backend = Math.max(0, Math.min(100, input.backendPct ?? 0))
  const started = input.startedAtMs ?? null
  const eta =
    input.estimatedMs && input.estimatedMs > 0
      ? input.estimatedMs
      : estimateAnalysisDurationMs(input.instanceCount)
  const now = input.nowMs ?? Date.now()

  let timeBased = 0
  if (started != null && eta > 0) {
    const elapsed = Math.max(0, now - started)
    // Ease-out so early movement is visible; never reach 100 on time alone.
    const raw = elapsed / eta
    timeBased = Math.min(97, (1 - Math.exp(-2.2 * raw)) * 100)
  }

  // Prefer the higher of checkpoint progress and ETA curve; stay under 97 until done.
  const blended = Math.max(backend, timeBased)
  if (status === 'queued' || status === 'running' || status === 'cancel_requested') {
    return Math.min(97, Math.max(backend, blended))
  }
  return Math.min(97, blended)
}
