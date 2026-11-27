import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { expect, it, vi } from 'vitest'
import { createTranslator } from '../../i18n'
import { summaryToVetCase } from '../lib/caseMapper'
import { CaseTable, caseOpenPath } from './CaseTable'

vi.mock('../shell/LocaleContext', () => ({
  useLocale: () => ({ locale: 'tr', t: createTranslator('tr') }),
}))

it('approved cases open the approved report; others the case detail', () => {
  expect(caseOpenPath({ id: 'case-1', status: 'onaylandi' })).toBe('/raporlar/case-1')
  expect(caseOpenPath({ id: 'case-2', status: 'uzman_incelemesinde' })).toBe('/vakalar/case-2')
})

it('lists cases without Study/Analysis columns or a View button, with the expert name (#77)', () => {
  const row = summaryToVetCase({
    case_id: 'case-table',
    patient_name: 'Pax',
    species: 'canine',
    modality: 'MR',
    anatomical_region: 'BRAIN',
    status: 'awaiting_review',
    created_at: '2026-11-23T10:00:00Z',
    assigned_reviewer_id: 'ayse@clinic.test',
    assigned_reviewer_name: 'Dr. Ayşe Kaya',
    series_count: 1,
    instance_count: 2,
  })
  const html = renderToStaticMarkup(
    createElement(StaticRouter, { location: '/vakalar', children: createElement(CaseTable, { cases: [row] }) }),
  )
  expect(html).toContain('Dr. Ayşe Kaya')
  expect(html).not.toContain('>ayse<')
  expect(html).not.toContain('>Study<')
  expect(html).not.toContain('>Analiz<')
  expect(html).not.toContain('2 görüntü')
  expect(html).not.toContain('Görüntüle')
  expect(html).toContain('Aç')
})
