/**
 * UI shows ``VM-408194147E09``; API / DB keys are ``case-408194147e09``.
 * Normalize before routing lookups and backend calls so mixed-case / display
 * ids do not surface as ``Case not found.``
 */
export function canonicalizeCaseId(caseId: string): string {
  const raw = (caseId || '').trim()
  if (!raw) return raw
  const lower = raw.toLowerCase()
  if (lower.startsWith('vm-')) return `case-${lower.slice(3)}`
  if (lower.startsWith('case-')) return `case-${lower.slice(5)}`
  return lower
}

export function isBackendCaseId(caseId: string | null | undefined): boolean {
  if (!caseId) return false
  return canonicalizeCaseId(caseId).startsWith('case-')
}
