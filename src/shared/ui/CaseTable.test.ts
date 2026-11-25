import { expect, it } from 'vitest'
import { caseOpenPath } from './CaseTable'

it('approved cases open the approved report; others the case detail', () => {
  expect(caseOpenPath({ id: 'case-1', status: 'onaylandi' })).toBe('/raporlar/case-1')
  expect(caseOpenPath({ id: 'case-2', status: 'uzman_incelemesinde' })).toBe('/vakalar/case-2')
})
