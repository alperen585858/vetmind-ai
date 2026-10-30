import { describe, expect, it } from 'vitest'
import {
  canExportApprovedReport,
  printSectionsForCase,
  reportProvenance,
} from './reportPrint'
import { recordToVetCase, mergeBackendCases, summaryToVetCase } from './caseMapper'
import type { BackendCaseRecord, BackendCaseSummary, VetCase } from '../types'

function approvedRecord(): BackendCaseRecord {
  return {
    case_id: 'case-pdf1',
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T12:00:00Z',
    status: 'approved',
    patient_name: 'Pasha',
    species: 'canine',
    breed: 'Golden',
    modality: 'MR',
    anatomical_region: 'BRAIN',
    clinical_history: 'Nöbet öyküsü — sentetik',
    classification_confirmed: true,
    study: {
      dicom_available: true,
      study_instance_uid: '1.2.3',
      series_count: 1,
      instance_count: 4,
      metadata_only: true,
    },
    structured_findings: {
      schema_version: '1.1.0',
      case_id: 'case-pdf1',
      source_model_id: 'mock-brain-mri-v1',
      source_kind: 'mock',
      execution_status: 'success',
      findings: [
        {
          finding_id: 'f1',
          finding_code: 'BRAIN-MOCK',
          description: 'Sentetik şüpheli lezyon',
          anatomical_location: 'brain',
          finding_status: 'suspected',
          source_model: 'mock-brain-mri-v1',
          requires_review: true,
          synthetic: true,
        },
      ],
      warnings: ['Mock adapter'],
      no_findings_returned: false,
      absences_not_confirmed: true,
      review_required: true,
    },
    draft_report: {
      report_id: 'rep-1',
      case_id: 'case-pdf1',
      status: 'approved',
      version: 1,
      immutable: true,
      synthetic: true,
      clinically_validated: false,
      generation: {
        provider_id: 'mock-llm',
        model_id: 'mock-draft-v1',
        model_version: '1.0.0-mock',
        generated_at: '2026-10-22T11:00:00Z',
        source_kind: 'mock',
      },
      technique: { text: 'Teknik: sentetik MR protokolü', cited_finding_ids: [] },
      findings: { text: 'Bulgular: sentetik açıklama — ğüşıöç', cited_finding_ids: ['f1'] },
      impression: { text: 'Değerlendirme: uzman incelemesi gerekli', cited_finding_ids: ['f1'] },
      recommendations: { text: 'Öneri: klinik korelasyon', cited_finding_ids: [] },
      validation_warnings: ['Yapısal doğrulama uyarısı örneği'],
      expert_review_status: 'approved',
      reviewer_comment: 'ok',
      rag_citations: [
        {
          source_id: 'rag-1',
          title: 'Demo kaynak',
          section: '1',
          passage: 'RAG pasajı klinik kanıt değildir',
          score: 0.1,
        },
      ],
      rag_note: 'RAG klinik doğrulama değildir',
    },
    review_history: [{ reviewer_id: 'expert-demo', action: 'approve', comment: 'ok' }],
  }
}

describe('reportPrint / PDF data binding', () => {
  it('maps approved backend record for print with MOCK provenance and Turkish text', () => {
    const c = recordToVetCase(approvedRecord())
    expect(c.status).toBe('onaylandi')
    expect(canExportApprovedReport(c)).toBe(true)
    expect(c.approvedBy).toBe('expert-demo')
    expect(c.reportNo).toMatch(/VMR-/i)

    const sections = printSectionsForCase(c)
    expect(sections.map((s) => s.key)).toEqual([
      'technique',
      'findings',
      'impression',
      'recommendations',
    ])
    expect(sections.some((s) => s.text.includes('ğüşıöç'))).toBe(true)
    expect(sections.some((s) => s.key === 'ayiriciTanilar')).toBe(false)

    const prov = reportProvenance(c)
    expect(prov.sourceKind).toBe('mock')
    expect(prov.synthetic).toBe(true)
    expect(prov.banner).toMatch(/AI TASLAK|DEMO|SENTETİK|KLİNİK/)
    expect(prov.modelLine).toContain('mock-brain-mri-v1')
    expect(prov.versionLabel).toMatch(/v\d+/)
  })

  it('refuses export when not approved or missing body', () => {
    const c = recordToVetCase(approvedRecord())
    expect(canExportApprovedReport({ ...c, status: 'uzman_incelemesinde' })).toBe(false)
    expect(
      canExportApprovedReport({
        ...c,
        backendDraft: undefined,
        report: undefined,
      }),
    ).toBe(false)
  })

  it('preserves hydrated report when list sync merges summaries', () => {
    const hydrated = recordToVetCase(approvedRecord())
    const summary: BackendCaseSummary = {
      case_id: 'case-pdf1',
      patient_name: 'Pasha',
      species: 'canine',
      breed: 'Golden',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      status: 'approved',
      created_at: '2026-10-22T10:00:00Z',
      classification_confirmed: true,
    }
    const merged = mergeBackendCases([hydrated], [summaryToVetCase(summary)])
    const row = merged.find((x) => x.id === 'case-pdf1') as VetCase
    expect(row.backendDraft?.findings.text).toContain('ğüşıöç')
    expect(canExportApprovedReport(row)).toBe(true)
    expect(printSectionsForCase(row).length).toBe(4)
  })
})
