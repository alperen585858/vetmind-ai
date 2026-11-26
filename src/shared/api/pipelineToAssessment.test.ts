import { describe, expect, it } from 'vitest'
import {
  assessmentSeverityForFinding,
  isTechnicalFindingCode,
  pipelineToAssessment,
} from './'
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
    // Technique notes stay in structured findings; the attention list shows only lesion claims.
    expect(ai.findings).toHaveLength(1)
    expect(ai.findings[0].severity).toBe('Orta')
    expect(ai.findings[0].text).toContain('(possible)')
    expect(ai.findings[0].text).toContain('[VENTRICLE-DILATION]')
  })

  it('says there is no focal claim when every finding is technical', () => {
    const ai = pipelineToAssessment(
      minimalFindings([
        { finding_code: 'IMAGE-QUALITY', finding_status: 'uncertain' },
        { finding_code: 'BRAIN-STRUCTURE', finding_status: 'uncertain' },
      ]),
      minimalReport(),
    )
    expect(ai.findings).toHaveLength(1)
    expect(ai.findings[0].severity).toBe('Düşük')
    expect(ai.findings[0].text).toMatch(/Odak anormallik iddiası yok/)
  })

  it('builds validation from verifier verdicts and categorized warnings', () => {
    const findings = minimalFindings([{ finding_code: 'VENTRICLE-DILATION' }])
    findings.warnings = [
      'Eksik bilgi: ırk, yaş girilmemiş. Irka özgü varyantlar…',
      'Sınırlama: Yüksek alanlı (9.4 T) muhtemelen preklinik tarayıcı.',
      'Kapsam: tespit edilen hedef karelerin tamamı görsel olarak gönderildi (görsel=1).',
      'VLM çıktısı eğitilmemiş genel modelden gelir; klinik doğrulama yoktur.',
    ]
    const report = minimalReport()
    report.verification = {
      verifier_model: 'judge',
      verdicts: [
        { section: 'findings', sentence: 'Ventrikül genişlemesi olası.', citations: ['F1'], label: 'supported' },
        {
          section: 'impression',
          sentence: 'Hidrosefali kesindir.',
          citations: ['F1'],
          label: 'unsupported',
          error_type: 'overstated_certainty',
        },
      ],
    }
    const v = pipelineToAssessment(findings, report).validation
    expect(v.map((x) => x.kind)).toEqual(['ok', 'unsupported', 'missing', 'note', 'note'])
    expect(v[2].text).toBe('ırk, yaş girilmemiş')
    expect(v[1].detail).toContain('overstated certainty')
    expect(v.some((x) => x.text === 'Pipeline notu')).toBe(false)
  })
})
