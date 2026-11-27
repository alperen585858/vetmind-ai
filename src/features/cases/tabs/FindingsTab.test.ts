import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, expect, it, vi } from 'vitest'
import { createTranslator, loadLocale } from '../../../i18n'
import { pipelineToAssessment } from '../../../shared/api'
import { summaryToVetCase } from '../../../shared/lib/caseMapper'
import type { BackendDraftReport, BackendFindings } from '../../../shared/types'
import { AssessmentView, findingStatusLabel } from './FindingsTab'

vi.mock('../../../shared/shell/LocaleContext', () => ({
  useLocale: () => ({ locale: 'tr', t: createTranslator('tr') }),
}))

beforeAll(() => loadLocale('en'))

const NOTE = 'ImagingModelInput v1.0.0 metadata_only=True; pixel_analysis_authorized=False'

const findings: BackendFindings = {
  schema_version: '1',
  case_id: 'case-ai',
  source_model_id: 'vlm',
  source_kind: 'real',
  execution_status: 'success',
  findings: [
    {
      finding_id: 'f1',
      finding_code: 'MOCK-TL-DISC-EXTRUSION',
      description: 'T13-L1 disk ekstrüzyonu',
      anatomical_location: 'T13-L1',
      finding_status: 'suspected',
      source_model: 'vlm',
      requires_review: true,
      synthetic: false,
    },
  ],
  warnings: [NOTE],
  no_findings_returned: false,
  absences_not_confirmed: true,
  review_required: true,
}

const draft: BackendDraftReport = {
  report_id: 'r1',
  case_id: 'case-ai',
  status: 'draft',
  synthetic: true,
  clinically_validated: false,
  generation: { provider_id: 'mock', model_id: 'llm', model_version: '1', generated_at: '2026-11-23T12:04:00Z' },
  technique: { text: 't', cited_finding_ids: [] },
  findings: { text: 'f', cited_finding_ids: [] },
  impression: { text: 'Değerlendirme metni', cited_finding_ids: [] },
  recommendations: { text: 'BOS analizi', cited_finding_ids: [] },
  validation_warnings: [],
}

it('translates finding statuses (#75)', () => {
  const t = createTranslator('tr')
  expect(findingStatusLabel(t, 'suspected')).toBe('şüpheli')
  expect(findingStatusLabel(createTranslator('en'), 'not_assessed')).toBe('not assessed')
})

it('AI findings tab: one card per finding with severity, no report-text repeats, notes under Details (#75)', () => {
  const c = {
    ...summaryToVetCase({
      case_id: 'case-ai',
      patient_name: 'Pax',
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'THORACOLUMBAR',
      status: 'awaiting_review',
      created_at: '2026-11-23T10:00:00Z',
    }),
    backendFindings: findings,
    ai: pipelineToAssessment(findings, draft),
  }
  const html = renderToStaticMarkup(createElement(AssessmentView, { c }))

  expect(html.match(/data-testid="finding-card"/g)).toHaveLength(1)
  expect(html).toContain('Yüksek')
  expect(html).toContain('şüpheli')
  expect(html).not.toContain('suspected')
  expect(html).not.toContain('MOCK-')
  expect(html).not.toContain('[TL-DISC-EXTRUSION]')
  // Report-text sections live on the Report tab now.
  expect(html).not.toContain('Vaka Özeti')
  expect(html).not.toContain('Değerlendirme metni')
  expect(html).not.toContain('Önerilen Ek Tetkikler')
  expect(html).not.toContain('Dikkat Edilmesi Gereken Bulgular')
  // The pipeline note is technical detail, not "missing information".
  expect(html).not.toContain('1 eksik')
  expect(html).toContain('data-testid="ai-technical-details"')
  expect(html).toContain(NOTE)
})
