import type { BackendPipelineResult, CaseStatus } from '../types'

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
