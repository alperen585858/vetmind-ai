import { describe, expect, it } from 'vitest'
import { canonicalizeCaseId, isBackendCaseId } from './caseId'

describe('canonicalizeCaseId', () => {
  it('lowercases case- hex ids', () => {
    expect(canonicalizeCaseId('case-408194147E09')).toBe('case-408194147e09')
    expect(canonicalizeCaseId('CASE-408194147E09')).toBe('case-408194147e09')
  })

  it('maps VM- display numbers onto case- keys', () => {
    expect(canonicalizeCaseId('VM-408194147E09')).toBe('case-408194147e09')
    expect(canonicalizeCaseId('vm-408194147e09')).toBe('case-408194147e09')
  })

  it('detects backend case ids', () => {
    expect(isBackendCaseId('VM-408194147E09')).toBe(true)
    expect(isBackendCaseId('case-abc')).toBe(true)
    expect(isBackendCaseId('local-1')).toBe(false)
  })
})
