/**
 * Helpers for the existing print-to-PDF report view (ApprovedReport + window.print).
 * Does not introduce a PDF library — keeps browser print as the export path.
 */

import { SECTION_LABELS } from '../data/mock'
import type { BackendDraftReport, BackendFindings, ReportSections, SectionKey, VetCase } from '../types'

export type PrintSection = {
  key: string
  label: string
  text: string
}

/** Sections to render/print. Backend drafts use only persisted 4 sections (no fabricated ayırıcı tanı). */
export function printSectionsForCase(c: VetCase): PrintSection[] {
  if (c.fromBackend && c.backendDraft) {
    const d = c.backendDraft
    return [
      { key: 'technique', label: SECTION_LABELS.klinikOzet, text: d.technique?.text ?? '' },
      { key: 'findings', label: SECTION_LABELS.bulgular, text: d.findings?.text ?? '' },
      { key: 'impression', label: SECTION_LABELS.degerlendirme, text: d.impression?.text ?? '' },
      { key: 'recommendations', label: SECTION_LABELS.oneriler, text: d.recommendations?.text ?? '' },
    ].filter((s) => s.text.trim().length > 0)
  }

  const report = c.report
  if (!report) return []

  const keys = Object.keys(SECTION_LABELS) as SectionKey[]
  return keys
    .map((k) => ({ key: k, label: SECTION_LABELS[k], text: report[k] ?? '' }))
    .filter((s) => s.text.trim().length > 0)
}

export type ProvenanceLabel = {
  banner: string
  sourceKind: 'mock' | 'real' | 'mixed' | 'manual' | 'unknown'
  synthetic: boolean
  modelLine: string
  reviewStatus: string
  versionLabel: string
}

/** Honest MOCK/REAL/MIXED labeling from persisted findings/draft — never invents confidence. */
export function reportProvenance(c: VetCase): ProvenanceLabel {
  const findings: BackendFindings | undefined = c.backendFindings
  const draft: BackendDraftReport | undefined = c.backendDraft
  const sourceKindRaw = (findings?.source_kind || draft?.generation?.source_kind || '').toLowerCase()
  const sourceKind =
    sourceKindRaw === 'real' ||
    sourceKindRaw === 'mixed' ||
    sourceKindRaw === 'mock' ||
    sourceKindRaw === 'manual'
      ? sourceKindRaw
      : c.fromBackend
        ? 'mock'
        : 'unknown'

  const synthetic = draft?.synthetic ?? findings?.findings?.some((f) => f.synthetic) ?? true
  const modelId = findings?.source_model_id || draft?.generation?.model_id || c.ai?.model || '—'
  const modelVersion = draft?.generation?.model_version
  const modelLine = modelVersion ? `${modelId} · v${modelVersion}` : String(modelId)

  let banner = 'AI TASLAK — KLİNİK KULLANIMA UYGUN DEĞİLDİR'
  if (sourceKind === 'manual') {
    banner = 'MANUEL RADYOLOG TASLAĞI — AI çıktısı değildir; klinik sertifikasyon iddiası yoktur'
  } else if (sourceKind === 'real') {
    banner = 'GERÇEK MODEL TASLAĞI — Uzman incelemesi zorunludur; klinik sertifikasyon iddiası yoktur'
  } else if (sourceKind === 'mixed') {
    banner = 'KARMA KAYNAK — Kaynaklar karışıktır; klinik doğrulama değildir'
  } else if (!c.fromBackend) {
    banner = 'YEREL TASLAK — Uzman incelemesi zorunludur'
  }

  const reviewStatus =
    c.status === 'onaylandi'
      ? `Onaylandı${c.approvedBy ? ` · ${c.approvedBy}` : ''}`
      : c.status === 'reddedildi'
        ? 'Reddedildi'
        : c.status === 'revizyon'
          ? 'Revizyon istendi'
          : draft?.status || c.status

  const version = draft?.version ?? c.currentReportVersion
  const versionLabel =
    version != null
      ? `v${version}${draft?.immutable ? ' · immutable' : ''}`
      : c.fromBackend
        ? '—'
        : 'local'

  return {
    banner,
    sourceKind,
    synthetic: Boolean(synthetic),
    modelLine,
    reviewStatus,
    versionLabel,
  }
}

/** True when print/export can proceed with persisted or local approved report body. */
export function canExportApprovedReport(c: VetCase | undefined): boolean {
  if (!c || c.status !== 'onaylandi') return false
  if (c.fromBackend) return Boolean(c.backendDraft || c.report)
  return Boolean(c.report)
}

/** Bind a historical draft onto a case view for print-to-PDF. */
export function caseWithDraftVersion(
  c: VetCase,
  draft: BackendDraftReport,
): VetCase {
  return {
    ...c,
    backendDraft: draft,
    report: {
      klinikOzet: draft.technique.text,
      bulgular: draft.findings.text,
      degerlendirme: draft.impression.text,
      ayiriciTanilar: '',
      oneriler: draft.recommendations.text,
    },
    currentReportVersion: draft.version,
    approvedBy: draft.reviewed_by || c.approvedBy,
    status: draft.status === 'approved' ? 'onaylandi' : c.status,
  }
}

export function sectionsFromLocalReport(report: ReportSections): PrintSection[] {
  return (Object.keys(SECTION_LABELS) as SectionKey[]).map((k) => ({
    key: k,
    label: SECTION_LABELS[k],
    text: report[k] ?? '',
  }))
}
