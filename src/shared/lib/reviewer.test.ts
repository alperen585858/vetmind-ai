import { expect, it } from 'vitest'
import { createTranslator } from '../../i18n'
import { reviewerDisplay } from './reviewer'

const t = createTranslator('tr')

it('shows the expert display name, never the e-mail prefix (#77)', () => {
  expect(reviewerDisplay({ assignedReviewerId: 'ayse@clinic.test', assignedReviewerName: 'Dr. Ayşe Kaya' }, t)).toBe('Dr. Ayşe Kaya')
  expect(reviewerDisplay({ assignedReviewerId: 'ayse@clinic.test' }, t)).toBe('Atanmış uzman')
  expect(reviewerDisplay({ assignedReviewerId: 'expert@demo.local' }, t)).toBe('Prof. Dr. Ahmet Demir')
})

it('shows "Atanmadı" for unassigned cases, never a review status', () => {
  expect(reviewerDisplay({}, t)).toBe('Atanmadı')
  expect(reviewerDisplay({ assignedReviewerId: '  ' }, t)).toBe('Atanmadı')
})
