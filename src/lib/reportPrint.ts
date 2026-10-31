/**
 * Helpers for the existing print-to-PDF report view (ApprovedReport + window.print).
 * Does not introduce a PDF library — keeps browser print as the export path.
 */

import { SECTION_LABELS } from '../data/mock'
import { translate } from '../i18n'
import { isLocale } from '../i18n/types'
import type { BackendDraftReport, BackendFindings, ReportSections, SectionKey, VetCase } from '../types'

export type PrintSection = {
  key: string
  label: string
  text: string
}

function documentLocale() {
  if (typeof document === 'undefined') return 'tr' as const
  const lang = document.documentElement.lang
  return isLocale(lang) ? lang : 'tr'
}

function sectionLabel(key: SectionKey): string {
  return translate(documentLocale(), `sections.${key}`)
}

const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[]

/** Sections to render/print. Backend drafts use only persisted 4 sections (no fabricated ayırıcı tanı). */
export function printSectionsForCase(c: VetCase): PrintSection[] {
  if (c.fromBackend && c.backendDraft) {
    const d = c.backendDraft
    return [
      { key: 'technique', label: sectionLabel('klinikOzet'), text: d.technique?.text ?? '' },
      { key: 'findings', label: sectionLabel('bulgular'), text: d.findings?.text ?? '' },
      { key: 'impression', label: sectionLabel('degerlendirme'), text: d.impression?.text ?? '' },
      { key: 'recommendations', label: sectionLabel('oneriler'), text: d.recommendations?.text ?? '' },
    ].filter((s) => s.text.trim().length > 0)
  }

  const report = c.report
  if (!report) return []

  return SECTION_KEYS.map((k) => ({ key: k, label: sectionLabel(k), text: report[k] ?? '' })).filter(
    (s) => s.text.trim().length > 0,
  )
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
  const locale = documentLocale()
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

  let banner = translate(locale, 'reports.provenance.aiDraft')
  if (sourceKind === 'manual') {
    banner = translate(locale, 'reports.provenance.manual')
  } else if (sourceKind === 'real') {
    banner = translate(locale, 'reports.provenance.real')
  } else if (sourceKind === 'mixed') {
    banner = translate(locale, 'reports.provenance.mixed')
  } else if (!c.fromBackend) {
    banner = translate(locale, 'reports.provenance.local')
  }

  const reviewStatus =
    c.status === 'onaylandi'
      ? c.approvedBy
        ? translate(locale, 'reports.provenance.approvedBy', { name: c.approvedBy })
        : translate(locale, 'status.onaylandi')
      : c.status === 'reddedildi'
        ? translate(locale, 'status.reddedildi')
        : c.status === 'revizyon'
          ? translate(locale, 'status.revizyon')
          : draft?.status || c.status

  const version = draft?.version ?? c.currentReportVersion
  const versionLabel =
    version != null
      ? `v${version}${draft?.immutable ? translate(locale, 'reports.provenance.immutableSuffix') : ''}`
      : c.fromBackend
        ? translate(locale, 'common.dash')
        : translate(locale, 'reports.provenance.localVersion')

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
  return SECTION_KEYS.map((k) => ({
    key: k,
    label: sectionLabel(k),
    text: report[k] ?? '',
  }))
}
