import type { TranslateFn } from '../../i18n'
import { demoAccountName } from '../auth/session'
import type { VetCase } from '../types'

/**
 * #77: name to show for a case's assigned expert. Never the e-mail prefix: the backend
 * display name, else the seeded demo account name, else a generic "Assigned expert".
 */
export function reviewerDisplay(
  c: Pick<VetCase, 'assignedReviewerId' | 'assignedReviewerName'>,
  t: TranslateFn,
): string {
  const id = c.assignedReviewerId?.trim()
  if (!id) return t('cases.unassigned')
  return c.assignedReviewerName?.trim() || demoAccountName(id) || t('cases.assignedExpert')
}
