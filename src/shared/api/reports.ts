import { currentActorId } from '../auth/session'
import { canonicalizeCaseId } from '../lib/caseId'
import { splitRecommendations } from '../lib/recommendations'
import type { AIAssessment, DifferentialLikelihood, ReportSections } from '../types'
import type { BackendCaseRecord, BackendDraftReport, BackendFindings, ValidationItem, VerdictLabel } from '../types'
import { fetchWithAuth, request, throwIfNotOk } from './client'

export type PublicReportView = {
  case_id: string
  patient_name: string
  report_version: number
  technique?: string | null
  findings?: string | null
  impression?: string | null
  recommendations?: string | null
  note?: string
}

/** Check a report link without loading the report (does not count as a view). */
export async function checkPublicReportLink(token: string): Promise<{ valid: boolean; report_version: number; expires_at: number }> {
  // POST body, not the query string: the token must not end up in proxy / server access logs.
  return request('/public/report-link', { method: 'POST', body: JSON.stringify({ token }) })
}

/** Load the approved report behind a link. Re-usable until expiry / revoke; audited. */
export async function fetchPublicReportView(token: string): Promise<PublicReportView> {
  return request('/public/report-view', { method: 'POST', body: JSON.stringify({ token }) })
}

export async function markReportDelivered(caseId: string): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/report/deliver`, { method: 'POST' })
}

export async function markReportViewed(caseId: string): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/report/viewed`, { method: 'POST' })
}

/** Append workspace evidence overlays onto an approved report package (figures only). */
export async function appendReportFigures(
  caseId: string,
  evidenceIds: string[],
): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/report/figures`, {
    method: 'POST',
    body: JSON.stringify({ evidence_ids: evidenceIds }),
  })
}

export async function getCaseFindings(
  caseId: string,
  signal?: AbortSignal,
): Promise<BackendFindings | null> {
  return request<BackendFindings | null>(`/cases/${caseId}/findings`, { signal })
}

/** Issue #108: radiologist's wording of the "change since the prior study" section. */
export async function saveReportComparison(caseId: string, text: string): Promise<BackendDraftReport> {
  return request(`/cases/${caseId}/report/draft`, {
    method: 'PUT',
    body: JSON.stringify({ editor_id: currentActorId(), comparison: text }),
  })
}

/** Bootstrap blank radiologist draft for failed / unsupported cases (no AI draft). */
export async function initManualReport(caseId: string): Promise<BackendDraftReport> {
  return request(`/cases/${caseId}/report/manual-init`, { method: 'POST' })
}

export async function saveBackendDraftReport(
  caseId: string,
  sections: ReportSections,
  note?: string,
): Promise<BackendDraftReport> {
  return request(`/cases/${caseId}/report/draft`, {
    method: 'PUT',
    body: JSON.stringify({
      editor_id: currentActorId(),
      technique: sections.klinikOzet,
      findings: sections.bulgular,
      impression: sections.degerlendirme,
      recommendations: sections.oneriler,
      note: note || undefined,
    }),
  })
}

export async function listReportVersions(
  caseId: string,
  signal?: AbortSignal,
): Promise<import('../types').BackendReportVersionSummary[]> {
  return request(`/cases/${caseId}/report/versions`, { signal })
}

export async function getReportVersion(
  caseId: string,
  version: number,
  signal?: AbortSignal,
): Promise<import('../types').BackendReportVersionSnapshot> {
  return request(`/cases/${caseId}/report/versions/${version}`, { signal })
}

export async function getBackendReport(
  caseId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<import('../types').BackendDraftReport> {
  const q = version != null ? `?version=${version}` : ''
  return request(`/cases/${caseId}/report${q}`, { signal })
}

/** Expert revision request → LLM rewrites the draft as a new version (can take ~10-60 s). */
export async function regenerateBackendReport(caseId: string, note: string) {
  return request<BackendCaseRecord>(`/cases/${caseId}/report/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: currentActorId(), note }),
  })
}

export async function submitBackendReview(caseId: string, payload: {
  action: 'approve' | 'reject' | 'request_revision'
  comment?: string
  reason_codes?: string[]
  edited_technique?: string
  edited_findings?: string
  edited_impression?: string
  edited_recommendations?: string
}): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/cases/${caseId}/review`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: currentActorId(), ...payload }),
  })
}

export const LIKELIHOOD_TR: Record<DifferentialLikelihood, string> = {
  high: 'Yüksek',
  moderate: 'Orta',
  low: 'Düşük',
}

export function draftToSections(report: BackendDraftReport): ReportSections {
  return {
    klinikOzet: report.technique.text,
    bulgular: report.findings.text,
    degerlendirme: report.impression.text,
    ayiriciTanilar: report.differentials?.length
      ? report.differentials
          .map((d, i) => `${i + 1}. ${d.name} — ${LIKELIHOOD_TR[d.likelihood]} olasılık${d.citations.length ? ` [${d.citations.join(', ')}]` : ''}`)
          .join('\n')
      : 'Sentetik taslak: LLM ayırıcı tanı listesi üretmedi. İzlenebilirlik için rapor bölümleri structured finding_id değerlerine atıf yapar.',
    oneriler: report.recommendations.text,
  }
}

function isDisclaimerWarning(text: string): boolean {
  return /SENTETİK|klinik doğrulan|klinik doğrulama yok|eğitilmemiş genel model|tıbbi görüntü yorumu|demo çıktı|radyolog incelemesi zorunlu|sentetiktir|pikselleri analiz etmez/i.test(
    text,
  )
}

/** Normalize so IMAGE_QUALITY and IMAGE-QUALITY match the same rules. */
export function normalizeFindingCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/_/g, '-')
}

/**
 * Technique + descriptive anatomy (not a lesion claim).
 * These must never show as clinical "Yüksek" in the attention list.
 */
const NON_LESION_FINDING_CODE =
  /^(IMAGE-QUALITY|REGION-APPEARANCE|ANATOMIC-STRUCTURE|SIGNAL-UNSPECIFIED|VLM-UNSPECIFIED|VLM-FINDING|TECHNIQUE|VISIBLE-ANATOMY|VENTRICLE-VIEW|VENTRICLE-VISUAL|VENTRICLE-STRUCTURE|VENTRICLE-SHAPE|VENTRICULAR-SYSTEM|BRAIN-PARENCHYMA|BRAIN-VENTRICLE|BRAIN-VENTRICLES|BRAIN-STRUCTURE)(-|$)/i

export function isTechnicalFindingCode(code: string): boolean {
  return NON_LESION_FINDING_CODE.test(normalizeFindingCode(code))
}

/** Map epistemic status → display severity; non-lesion codes always Düşük. */
export function assessmentSeverityForFinding(
  code: string,
  status: string,
): AIAssessment['findings'][number]['severity'] {
  if (isTechnicalFindingCode(code)) return 'Düşük'
  if (status === 'suspected') return 'Yüksek'
  if (status === 'possible') return 'Orta'
  return 'Düşük'
}

const MISSING_PREFIX = 'Eksik bilgi:'
const LIMITATION_PREFIX = 'Sınırlama:'

function firstSentence(text: string, max = 110): string {
  const t = text.trim()
  const cut = t.search(/[.;](\s|$)/)
  const s = cut > 0 ? t.slice(0, cut) : t
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Pipeline warning → validation box. Prefixed warnings carry their own category. */
export function warningToValidation(w: string): ValidationItem {
  const text = w.trim()
  if (text.startsWith(MISSING_PREFIX)) {
    const body = text.slice(MISSING_PREFIX.length).trim()
    return { kind: 'missing', text: firstSentence(body), detail: body }
  }
  if (text.startsWith(LIMITATION_PREFIX)) {
    const body = text.slice(LIMITATION_PREFIX.length).trim()
    return { kind: 'note', text: firstSentence(body), detail: body }
  }
  return { kind: 'note', text: firstSentence(text), detail: text }
}

const VERDICT_KIND: Record<VerdictLabel, ValidationItem['kind']> = {
  supported: 'ok',
  partially_supported: 'unsupported',
  unsupported: 'unsupported',
  contradicted: 'unsupported',
}

const VERDICT_TR: Record<VerdictLabel, string> = {
  supported: 'Kanıtla destekleniyor',
  partially_supported: 'Kısmen destekleniyor',
  unsupported: 'Kanıtla desteklenmiyor',
  contradicted: 'Kanıtla çelişiyor',
}

/** Claim verifier verdicts → validation boxes (the only source of ok/unsupported). */
export function verdictsToValidation(report: BackendDraftReport): ValidationItem[] {
  return (report.verification?.verdicts ?? []).map((v) => {
    const refs = v.citations?.length ? ` [${v.citations.join(', ')}]` : ''
    const note = v.note?.trim() ? ` ${v.note.trim()}` : ''
    const err = v.error_type && v.error_type !== 'none' ? ` (${v.error_type.replace(/_/g, ' ')})` : ''
    return {
      kind: VERDICT_KIND[v.label] ?? 'unsupported',
      text: firstSentence(v.sentence, 120),
      detail: `${VERDICT_TR[v.label] ?? v.label}${err}.${note}${refs}`,
    }
  })
}

export function pipelineToAssessment(findings: BackendFindings, report: BackendDraftReport): AIAssessment {
  const mapped = findings.findings.map((f) => {
    const code = normalizeFindingCode(f.finding_code)
    // #75: plain description; status and severity are shown as labels, internal codes not in the text.
    return {
      text: f.description,
      severity: assessmentSeverityForFinding(code, f.finding_status),
    }
  })
  const warnings = findings.warnings.filter((w) => !isDisclaimerWarning(w))
  // Missing inputs and analysis limitations are clinically actionable → validation;
  // remaining pipeline notes stay under the folded technical details (#75).
  const isCategorized = (w: string) => w.trim().startsWith(MISSING_PREFIX) || w.trim().startsWith(LIMITATION_PREFIX)
  return {
    summary: report.impression.text,
    findings: mapped.length
      ? mapped
      : [{ text: 'Görüntüleme bağdaştırıcısı bulgu döndürmedi. Bu, hastalığın yokluğu anlamına gelmez.', severity: 'Orta' }],
    differentials: (report.differentials ?? []).map((d) => ({
      name: d.name,
      probability: 0,
      pro: d.supporting,
      con: d.against,
      citations: [],
      likelihood: d.likelihood,
      aliases: d.citations,
    })),
    recommendedTests: splitRecommendations(report.recommendations.text),
    validation: [...verdictsToValidation(report), ...warnings.filter(isCategorized).map(warningToValidation)],
    technicalNotes: warnings.filter((w) => !isCategorized(w)),
    model: `${findings.source_model_id} + ${report.generation.model_id}`,
    generatedAt: report.generation.generated_at,
  }
}

export async function downloadApprovedReportPdf(caseId: string, version?: number): Promise<Blob> {
  const q = version != null ? `?version=${version}` : ''
  const id = canonicalizeCaseId(caseId)
  const res = await fetchWithAuth(`/cases/${id}/report/pdf${q}`)
  await throwIfNotOk(res, 'PDF download failed')
  return res.blob()
}

/** Working-store overlay PNG for an evidence id (auth required). Caller must revokeObjectURL. */
export async function fetchEvidenceOverlayObjectUrl(caseId: string, evidenceId: string): Promise<string> {
  const res = await fetchWithAuth(
    `/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`,
  )
  await throwIfNotOk(res, res.status === 404 ? 'Evidence overlay not found' : `Evidence overlay failed (${res.status})`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** Immutable approved-report package overlay. Caller must revokeObjectURL. */
export async function fetchApprovedEvidenceOverlayObjectUrl(
  caseId: string,
  version: number,
  evidenceId: string,
): Promise<string> {
  const res = await fetchWithAuth(
    `/cases/${encodeURIComponent(caseId)}/reports/${version}/evidence/${encodeURIComponent(evidenceId)}`,
  )
  await throwIfNotOk(
    res,
    res.status === 404 ? 'Approved evidence overlay not found' : `Approved evidence overlay failed (${res.status})`,
  )
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

export async function reviewCaseEvidence(
  caseId: string,
  evidenceId: string,
  body: {
    action: 'accept' | 'reject' | 'set_include' | 'edit' | 'verify' | 'unverify'
    include_in_report?: boolean
    vet_note?: string
    bbox?: {
      x_min: number
      y_min: number
      x_max: number
      y_max: number
      coordinate_space?: string
      transform_chain?: { name: string; params: Record<string, number> }[]
    }
  },
) {
  return request<import('../types').BackendFindings>(`/cases/${caseId}/evidence/${evidenceId}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function addManualCaseEvidence(
  caseId: string,
  body: {
    finding_id: string
    bbox: {
      x_min: number
      y_min: number
      x_max: number
      y_max: number
      coordinate_space?: string
    }
    sop_instance_uid?: string
    frame_index?: number
    description?: string
    include_in_report?: boolean
  },
) {
  return request<import('../types').BackendFindings>(`/cases/${caseId}/evidence`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
