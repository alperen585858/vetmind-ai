import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, FileText, Maximize2, Minimize2, X } from 'lucide-react'
import { Logo } from './Logo'
import { REPORT_TEMPLATES, type ReportTemplateId } from '../data/reportTemplates'
import { SECTION_LABELS } from '../data/mock'
import { fmtDate } from '../lib/format'
import type { ReportSections, SectionKey, VetCase } from '../types'

/** Sections shown on the live A4 page — matches approved PDF body (+ optional ayırıcı). */
const DOC_KEYS: SectionKey[] = [
  'klinikOzet',
  'bulgular',
  'degerlendirme',
  'ayiriciTanilar',
  'oneriler',
]

function AutoTextarea({
  value,
  disabled,
  onChange,
  placeholder,
}: {
  value: string
  disabled?: boolean
  onChange: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.max(72, el.scrollHeight)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={3}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-[1.65] text-navy-900 outline-none placeholder:text-slate-300 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70"
    />
  )
}

export function ReportDocumentEditor({
  caseData,
  value,
  onChange,
  disabled = false,
  onApplyTemplate,
  className = '',
}: {
  caseData: VetCase
  value: ReportSections
  onChange: (next: ReportSections) => void
  disabled?: boolean
  onApplyTemplate?: (id: ReportTemplateId) => void
  className?: string
}) {
  const deskRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const p = caseData.patient
  const reviewStatus =
    caseData.status === 'onaylandi'
      ? `Onaylandı${caseData.approvedBy ? ` · ${caseData.approvedBy}` : ''}`
      : caseData.status === 'reddedildi'
        ? 'Reddedildi'
        : caseData.status === 'revizyon'
          ? 'Revizyon istendi'
          : caseData.backendDraft?.status || caseData.status

  useEffect(() => {
    const onFs = () => {
      const active = document.fullscreenElement === deskRef.current
      setFullscreen(active)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = async () => {
    const el = deskRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen()
      else if (document.fullscreenElement) {
        await document.exitFullscreen()
        await el.requestFullscreen()
      } else await el.requestFullscreen()
    } catch {
      /* ignore — browser may block without gesture */
    }
  }

  return (
    <div className={className}>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          A4 rapor belgesi · yazarken son hali
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
            (gri alana çift tık → tam ekran)
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <FileText className="h-3.5 w-3.5" />
            Şablon
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
              disabled={disabled}
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value as ReportTemplateId
                if (!id) return
                const tpl = REPORT_TEMPLATES.find((t) => t.id === id)
                if (!tpl) return
                onChange({ ...tpl.sections })
                onApplyTemplate?.(id)
                e.target.value = ''
              }}
            >
              <option value="">Şablon uygula…</option>
              {REPORT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-800 shadow-sm transition hover:bg-slate-50"
            title={fullscreen ? 'Tam ekrandan çık (Esc)' : 'Raporu tam ekran aç'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? 'Küçült' : 'Tam ekran'}
          </button>
        </div>
      </div>

      {/* Desk + A4 sheet */}
      <div
        ref={deskRef}
        onDoubleClick={(e) => {
          const t = e.target as HTMLElement
          if (t.closest('textarea, input, select, button, a, label')) return
          void toggleFullscreen()
        }}
        className={`rounded-xl bg-slate-200/70 p-3 sm:p-5 print:bg-transparent print:p-0 ${
          fullscreen ? 'flex h-full flex-col overflow-y-auto p-6 sm:p-8' : ''
        }`}
      >
        {fullscreen && (
          <div className="no-print sticky top-0 z-10 mb-4 flex items-center justify-between gap-2 rounded-lg bg-navy-950/90 px-3 py-2 text-white backdrop-blur">
            <p className="text-xs font-medium text-sky-100">A4 rapor · tam ekran · Esc ile çık</p>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
            >
              <X className="h-3.5 w-3.5" />
              Kapat
            </button>
          </div>
        )}
        <article
          className="mx-auto w-full max-w-[210mm] origin-top bg-white text-navy-900 shadow-[0_12px_40px_rgba(15,23,42,0.18)] ring-1 ring-slate-300/60 print:max-w-none print:shadow-none print:ring-0"
          style={{ minHeight: '297mm' }}
        >
          <header className="flex flex-col gap-4 border-b-4 border-teal-600 px-8 py-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Logo />
            </div>
            <div className="text-left text-sm sm:text-right">
              <p className="text-lg font-semibold text-navy-900">Veteriner Radyoloji Değerlendirme Raporu</p>
              <p className="text-slate-500">
                Rapor No:{' '}
                <span className="font-mono font-medium text-navy-800">{caseData.reportNo ?? '—'}</span>
              </p>
              <p className="text-slate-500">
                Vaka No: <span className="font-mono">{caseData.no}</span>
              </p>
            </div>
          </header>

          <section className="grid gap-6 border-b border-slate-100 px-8 py-5 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Hasta bilgileri
              </p>
              <dl className="space-y-1">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Ad</dt>
                  <dd className="font-medium text-navy-900">{p.name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Tür / Irk</dt>
                  <dd className="text-navy-900">
                    {p.species} · {p.breed}
                  </dd>
                </div>
                {!caseData.fromBackend && (
                  <>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-slate-500">Yaş / Kilo</dt>
                      <dd className="text-navy-900">
                        {p.age} yaş · {p.weight} kg
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-slate-500">Sahip</dt>
                      <dd className="text-navy-900">{p.ownerName}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                İnceleme / klinik
              </p>
              <dl className="space-y-1">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Klinik</dt>
                  <dd className="text-navy-900">{caseData.clinic || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Modalite</dt>
                  <dd className="text-navy-900">{caseData.modality ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Bölge</dt>
                  <dd className="text-navy-900">{caseData.anatomicalRegion ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">Başvuru</dt>
                  <dd className="text-navy-900">{fmtDate(caseData.createdAt)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-slate-500">İnceleme</dt>
                  <dd className="text-navy-900">{reviewStatus}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="space-y-7 px-8 py-6">
            {DOC_KEYS.map((key) => (
              <div key={key} className="group">
                <h3 className="mb-2 border-b border-slate-100 pb-1 text-sm font-semibold uppercase tracking-wide text-teal-700">
                  {SECTION_LABELS[key]}
                </h3>
                <div
                  className={`rounded-sm transition ${
                    disabled
                      ? ''
                      : 'ring-0 focus-within:bg-teal-50/30 focus-within:ring-1 focus-within:ring-teal-200'
                  }`}
                >
                  <AutoTextarea
                    value={value[key] ?? ''}
                    disabled={disabled}
                    placeholder={
                      key === 'ayiriciTanilar'
                        ? 'Opsiyonel — boş bırakılabilir'
                        : 'Bu bölüme yazın…'
                    }
                    onChange={(v) => onChange({ ...value, [key]: v })}
                  />
                </div>
              </div>
            ))}
          </section>

          <footer className="mt-auto border-t border-slate-200 bg-slate-50/70 px-8 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-start gap-3">
                <BadgeCheck className="h-8 w-8 text-emerald-600/80" />
                <div className="text-sm">
                  <p className="text-slate-500">Onaylayan uzman</p>
                  <p className="font-semibold text-navy-900">
                    {caseData.approvedBy || caseData.backendDraft?.reviewed_by || '— (onay sonrası)'}
                  </p>
                </div>
              </div>
              <div className="text-sm sm:text-right">
                <p className="text-slate-500">Onay tarihi</p>
                <p className="font-semibold text-navy-900">
                  {caseData.approvedAt ? fmtDate(caseData.approvedAt) : '— (onay sonrası)'}
                </p>
              </div>
            </div>
            <p className="mt-5 border-t border-slate-200/80 pt-4 text-[10px] font-medium text-slate-500">
              VRM Görüntüleme ve Veteriner Sağlık Hizmetleri Tic. A.Ş. işbirliğiyle
            </p>
          </footer>
        </article>
      </div>
    </div>
  )
}
