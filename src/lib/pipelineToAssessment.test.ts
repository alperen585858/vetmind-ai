import { describe, expect, it } from 'vitest'
import {
  assessmentSeverityForFinding,
  isTechnicalFindingCode,
  pipelineToAssessment,
} from './backend'
import type { BackendDraftReport, BackendFindings } from '../types'

function minimalFindings(overrides: Partial<BackendFindings['findings'][number]>[]): BackendFindings {
  return {
    schema_version: '1',
    case_id: 'c1',
    source_model_id: 'vlm',
    source_kind: 'real',
    execution_status: 'success',
    findings: overrides.map((o, i) => ({
      finding_id: `f${i}`,
      finding_code: 'LESION',
      description: 'desc',
      anatomical_location: 'brain',
      finding_status: 'uncertain',
      source_model: 'vlm',
      requires_review: true,
      synthetic: false,
      ...o,
    })),
    warnings: [],
    no_findings_returned: false,
    absences_not_confirmed: true,
    review_required: true,
  }
}

function minimalReport(): BackendDraftReport {
  return {
    report_id: 'r1',
    case_id: 'c1',
    status: 'draft',
    synthetic: true,
    clinically_validated: false,
    generation: {
      provider_id: 'mock',
      model_id: 'llm',
      model_version: '1',
      generated_at: '2026-01-01T00:00:00Z',
    },
    technique: { text: 't', cited_finding_ids: [] },
    findings: { text: 'f', cited_finding_ids: [] },
    impression: { text: 'impression', cited_finding_ids: [] },
    recommendations: { text: 'rec', cited_finding_ids: [] },
    validation_warnings: [],
  }
}

describe('assessmentSeverityForFinding', () => {
  it('forces technical/descriptive codes to Düşük even when suspected', () => {
    expect(isTechnicalFindingCode('IMAGE-QUALITY')).toBe(true)
    expect(isTechnicalFindingCode('IMAGE_QUALITY')).toBe(true)
    expect(assessmentSeverityForFinding('IMAGE-QUALITY', 'suspected')).toBe('Düşük')
    expect(assessmentSeverityForFinding('IMAGE_QUALITY', 'suspected')).toBe('Düşük')
    expect(assessmentSeverityForFinding('ANATOMIC-STRUCTURE', 'suspected')).toBe('Düşük')
    expect(assessmentSeverityForFinding('VENTRICLE-STRUCTURE', 'suspected')).toBe('Düşük')
    expect(assessmentSeverityForFinding('BRAIN-PARENCHYMA', 'possible')).toBe('Düşük')
    expect(assessmentSeverityForFinding('VLM-UNSPECIFIED', 'possible')).toBe('Düşük')
  })

  it('maps pathology status to severity', () => {
    expect(assessmentSeverityForFinding('VENTRICLE-DILATION', 'suspected')).toBe('Yüksek')
    expect(assessmentSeverityForFinding('VENTRICLE-DILATION', 'possible')).toBe('Orta')
    expect(assessmentSeverityForFinding('VENTRICLE-DILATION', 'uncertain')).toBe('Düşük')
  })
})

describe('pipelineToAssessment', () => {
  it('embeds status in text and demotes technical suspected findings', () => {
    const ai = pipelineToAssessment(
      minimalFindings([
        {
          finding_code: 'IMAGE-QUALITY',
          finding_status: 'suspected',
          description: 'net izlenmektedir',
        },
        {
          finding_code: 'VENTRICLE-DILATION',
          finding_status: 'possible',
          description: 'genişleme',
        },
      ]),
      minimalReport(),
    )
    expect(ai.findings[0].severity).toBe('Düşük')
    expect(ai.findings[0].text).toContain('(suspected)')
    expect(ai.findings[0].text).toContain('[IMAGE-QUALITY]')
    expect(ai.findings[1].severity).toBe('Orta')
    expect(ai.findings[1].text).toContain('(possible)')
  })
})
