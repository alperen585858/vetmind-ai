import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  Loader2,
  Stethoscope,
  XCircle,
} from 'lucide-react'
import { useLocale } from '../../../context/LocaleContext'
import { Card, CardHeader } from '../../../components/Card'
import { SeverityBadge } from '../../../components/StatusBadge'
import { Citations } from '../../../components/CitationChip'
import { EmptyState } from '../../../components/EmptyState'
import { fmtDate } from '../../../lib/format'
import { displayFindingCode, displayFindingDescription } from '../../../lib/displayClean'
import { CitedText } from '../../../components/CitedText'
import type { ValidationItem, VetCase } from '../../../types'

const LIKELIHOOD_STYLE = {
  high: 'bg-teal-100 text-teal-800',
  moderate: 'bg-sky-100 text-sky-800',
  low: 'bg-slate-100 text-slate-600',
} as const

function ValidationBox({ v }: { v: ValidationItem }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const meta = {
    ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: t('cases.detail.valOk') },
    missing: { cls: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: t('cases.detail.valMissing') },
    unsupported: { cls: 'border-rose-200 bg-rose-50 text-rose-900', icon: <XCircle className="h-4 w-4 text-rose-600" />, label: t('cases.detail.valUnsupported') },
  }[v.kind]
  return (
    <div className={`rounded-lg border ${meta.cls}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5">{meta.icon}</span>
        <span className="flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{meta.label}</span>
          <span className="block text-sm font-medium">{v.text}</span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 opacity-60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-current/10 px-3 pb-3 pl-10 pt-2 text-sm opacity-90">
          {v.detail} <Citations ids={v.citations} />
        </div>
      )}
    </div>
  )
}

export function AssessmentView({ c, compact = false }: { c: VetCase; compact?: boolean }) {
  const { t, locale } = useLocale()
  const ai = c.ai
  if (!ai) {
    return (
      <Card>
        <EmptyState
          icon={c.status === 'taslak' ? <FileText className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          title={c.status === 'taslak' ? t('cases.detail.noAiYet') : t('cases.detail.aiRunning')}
          text={c.status === 'taslak' ? t('cases.detail.noAiYetBody') : t('cases.detail.aiRunningBody')}
        />
      </Card>
    )
  }
  return (
    <div className="space-y-5">
      {c.backendFindings && (
        <Card>
          <CardHeader title={t('cases.detail.structuredFindings')} icon={<Brain className="h-5 w-5" />} />
          <div className="space-y-3 p-5 text-sm text-navy-800">
            {c.backendFindings.findings.length === 0 ? (
              <p>{t('cases.detail.noFindingsReturned')}</p>
            ) : (
              <ul className="space-y-2">
                {c.backendFindings.findings.map((f) => (
                  <li key={f.finding_id} className="rounded-lg border border-slate-200 p-3">
                    <p className="font-medium text-teal-800">{displayFindingCode(f.finding_code)}</p>
                    <p className="mt-1">{displayFindingDescription(f.description)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {[displayFindingDescription(f.anatomical_location), f.finding_status].filter(Boolean).join(' · ')}
                    </p>
                    {(f.evidence_references?.length ?? 0) > 0 && (
                      <p className="mt-1 font-mono text-[11px] text-violet-800">
                        Kanıt: {f.evidence_references!.map((e) => e.description).filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {f.uncertainty_note ? (
                      <p className="mt-1 text-[11px] text-amber-800">Belirsizlik: {f.uncertainty_note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {(c.backendFindings.analysis_coverage || c.backendFindings.processing_metadata?.frames_detected) && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-semibold text-navy-900">Analiz kapsamı</p>
                {(() => {
                  const cov = c.backendFindings!.analysis_coverage
                  const meta = c.backendFindings!.processing_metadata
                  const scope = cov?.analysis_scope ?? meta?.analysis_scope ?? '—'
                  const detected = cov?.frames_detected ?? Number(meta?.frames_detected || 0)
                  const decoded =
                    cov?.frames_decoded ?? Number(meta?.frames_decoded || 0)
                  const visual = cov?.frames_visually_analyzed ?? Number(meta?.frames_visually_analyzed || meta?.images_sent || 0)
                  const files = cov?.dicom_files_total ?? Number(meta?.dicom_files_total || meta?.study_dicom_instances || 0)
                  const series = cov?.series_total ?? Number(meta?.series_total || 0)
                  const seriesOk = cov?.series_analyzed ?? Number(meta?.series_analyzed || 0)
                  const skipped = cov?.frames_skipped ?? Number(meta?.frames_skipped || 0)
                  const undec = cov?.dicom_files_undecodable ?? Number(meta?.dicom_files_undecodable || 0)
                  const complete = cov?.analysis_complete ?? meta?.analysis_complete === 'true'
                  const metadataOnly =
                    detected > 0 && visual <= 0
                      ? true
                      : meta?.metadata_only === 'true'
                  return (
                    <>
                      <p className="mt-1">
                        Kapsam: <span className="font-mono font-semibold">{scope}</span>
                        {complete ? ' (hedef kareler görsel tamam)' : ' (tam görsel analiz değil)'}
                      </p>
                      <p className="mt-1">
                        DICOM dosya {files} · seri {seriesOk}/{series} · tespit {detected} ·
                        decode {decoded} · görsel analiz {visual} · atlanan {skipped}
                        {undec ? ` · çözülemeyen dosya ${undec}` : ''}
                      </p>
                      {metadataOnly && (
                        <p className="mt-1 text-amber-800">
                          Yalnızca metadata/envanter — görsel analiz yapılmadı.
                        </p>
                      )}
                      {(cov?.series?.length || 0) > 0 && (
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px]">
                          {cov!.series!.map((s, i) => (
                            <li key={s.series_instance_uid || i}>
                              {(s.series_description || s.series_instance_uid || 'seri').slice(0, 48)}
                              {s.is_localizer ? ' [loc]' : ''}: tespit {s.frames_detected}
                              {' · '}decode {s.frames_decoded ?? 0}
                              {' · '}görsel {s.frames_visually_analyzed}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
            {(c.backendFindings.potential_conflicts?.length ?? 0) > 0 && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                <p className="font-semibold">{t('cases.detail.potentialConflicts')}</p>
                <ul className="mt-2 space-y-2">
                  {c.backendFindings.potential_conflicts!.map((pc) => (
                    <li key={pc.conflict_id} className="text-xs">
                      <span className="font-mono font-semibold">{pc.conflict_id}</span>
                      {(pc.reason_codes?.length ?? 0) > 0 && (
                        <span className="ml-2 text-rose-800">[{pc.reason_codes!.join(', ')}]</span>
                      )}
                      {pc.group_key ? (
                        <span className="ml-2 font-mono text-rose-700/80">group={pc.group_key}</span>
                      ) : null}
                      <p className="mt-0.5 text-rose-900/90">{pc.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
      <div className={`grid gap-5 ${compact ? '' : 'xl:grid-cols-3'}`}>
        <div className={`space-y-5 ${compact ? '' : 'xl:col-span-2'}`}>
          <Card>
            <CardHeader title={t('cases.detail.caseSummary')} subtitle={`${ai.model} · ${fmtDate(ai.generatedAt, locale)}`} icon={<Brain className="h-5 w-5" />} />
            <CitedText
              text={ai.summary}
              citationMap={c.backendDraft?.citation_map}
              sources={c.backendDraft?.rag_citations}
              findings={c.backendFindings?.findings}
              className="p-5 text-[15px] leading-relaxed text-navy-800"
            />
          </Card>
          <Card>
            <CardHeader title={t('cases.detail.findingsOfNote')} icon={<AlertCircle className="h-5 w-5" />} />
            <ul className="divide-y divide-slate-100">
              {ai.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <SeverityBadge severity={f.severity} />
                  <p className="flex-1 text-sm text-navy-800">{f.text} <Citations ids={f.citations} /></p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t('cases.detail.differentials')} subtitle={t('cases.detail.differentialsSub')} icon={<Stethoscope className="h-5 w-5" />} />
            {!ai.differentials.length && (
              <p className="px-5 py-4 text-sm text-slate-500">{t('cases.detail.noDifferentials')}</p>
            )}
            <div className="divide-y divide-slate-100">
              {ai.differentials.map((d, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {d.likelihood ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1 font-semibold text-navy-900">
                          {i + 1}. {d.name}
                          {d.aliases?.length ? (
                            <CitedText
                              text={`[${d.aliases.join(', ')}]`}
                              citationMap={c.backendDraft?.citation_map}
                              sources={c.backendDraft?.rag_citations}
                              findings={c.backendFindings?.findings}
                              className="inline text-sm font-normal"
                            />
                          ) : null}
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LIKELIHOOD_STYLE[d.likelihood]}`}>
                          {t(`cases.detail.likelihood.${d.likelihood}`)}
                        </span>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-navy-900">{i + 1}. {d.name} <Citations ids={d.citations} /></p>
                        <span className="font-mono text-sm font-semibold text-navy-700">%{d.probability}</span>
                      </>
                    )}
                  </div>
                  {!d.likelihood && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${d.probability >= 50 ? 'bg-teal-500' : d.probability >= 20 ? 'bg-sky-400' : 'bg-slate-400'}`} style={{ width: `${d.probability}%` }} />
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{t('cases.detail.supporting')}</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.pro.length ? d.pro.map((x, j) => <li key={j} className="flex gap-2"><span className="text-emerald-500">+</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">{t('cases.detail.against')}</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.con.length ? d.con.map((x, j) => <li key={j} className="flex gap-2"><span className="text-rose-500">−</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title={t('cases.detail.recommendedTests')} icon={<ClipboardList className="h-5 w-5" />} />
            <ol className="list-decimal space-y-1.5 py-4 pl-10 pr-5 text-sm text-navy-800">
              {ai.recommendedTests.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          {(() => {
            const validation = ai.validation.filter(
              (v) =>
                !/SENTETİK|klinik doğrulan|tıbbi görüntü|radyolog incelemesi|AI ön değerlendirme|Pipeline uyarısı/i.test(
                  `${v.text} ${v.detail}`,
                ),
            )
            if (!validation.length) return null
            return (
              <Card>
                <CardHeader title={t('cases.detail.validationReport')} subtitle={t('cases.detail.validationReportSub')} icon={<CheckCircle2 className="h-5 w-5" />} />
                <div className="flex gap-2 px-5 pt-4 text-xs">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{t('cases.detail.validatedCount', { n: validation.filter((v) => v.kind === 'ok').length })}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{t('cases.detail.missingCount', { n: validation.filter((v) => v.kind === 'missing').length })}</span>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{t('cases.detail.unsupportedCount', { n: validation.filter((v) => v.kind === 'unsupported').length })}</span>
                </div>
                <div className="space-y-2.5 p-5">
                  {validation.map((v, i) => (
                    <ValidationBox key={i} v={v} />
                  ))}
                </div>
              </Card>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
