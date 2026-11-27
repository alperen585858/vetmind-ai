import type { BackendPipelineResult, CaseStatus } from '../../../shared/types'

/**
 * Map FastAPI pipeline outcome to frontend CaseStatus.
 * Failed analysis must never become expert "revizyon".
 */
export function caseStatusFromBackendOutcome(
  outcome: BackendPipelineResult['outcome'] | undefined,
): CaseStatus {
  if (outcome === 'failed') return 'analiz_basarisiz'
  if (outcome === 'unsupported') return 'manuel_inceleme'
  return 'uzman_incelemesinde'
}

/** URL value for the case list's "awaiting report" filter (dashboard shortcut, issue #91). */
export const AWAITING_REPORT_FILTER = 'rapor-bekleyen'

/** A case whose report is not approved yet (rejected cases are closed, not waiting). */
export function isAwaitingReport(status: CaseStatus): boolean {
  return status !== 'onaylandi' && status !== 'reddedildi' && status !== 'iptal'
}

/** URL value for the case list's "overdue" filter (clinic manager). */
export const OVERDUE_FILTER = 'gecikmis'

/** Still waiting for a report and past the radiologist's review deadline. */
export function isOverdueCase(
  c: { status: CaseStatus; reviewDueAt?: string | null },
  now = Date.now(),
): boolean {
  if (!isAwaitingReport(c.status) || !c.reviewDueAt) return false
  const due = Date.parse(c.reviewDueAt)
  return !Number.isNaN(due) && due <= now
}
