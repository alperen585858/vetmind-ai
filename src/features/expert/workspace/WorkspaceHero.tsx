import { ChevronLeft, ChevronRight, Clock, FileSearch, Image as ImageIcon, Save } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Button } from '../../../shared/ui/Button'
import { PriorityBadge } from '../../../shared/ui/StatusBadge'
import { SpeciesIcon3D } from '../../../shared/ui/SpeciesIcon3D'
import { HoloOrgan } from '../../../shared/ui/HoloOrgan'
import { modalityLabel, regionLabel } from '../../../shared/lib/displayClean'
import { formatSlaRemaining, slaBadgeClass, slaHoursForPriority, slaLabelsFromT, slaTone } from '../../../shared/lib/reviewSla'
import type { VetCase } from '../../../shared/types'

/** Case header: patient, badges, prev/next in the worklist, DICOM toggle and save. */
export function WorkspaceHero({
  c,
  facts,
  clinicalText,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  showDicom,
  onToggleDicom,
  saving,
  immutable,
  onSave,
}: {
  c: VetCase
  facts: { label: string; value: string }[]
  clinicalText: string
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  showDicom: boolean
  onToggleDicom: () => void
  saving: boolean
  immutable: boolean
  onSave: () => void
}) {
  const { t } = useLocale()
  const navButton =
    'inline-flex min-h-9 items-center px-2.5 text-navy-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-50 via-white to-sky-50 p-5 shadow-[0_6px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-teal-100 sm:p-6">
      <div className="pointer-events-none absolute -right-6 -top-6 opacity-[0.12]" aria-hidden>
        <HoloOrgan region={c.anatomicalRegion} size={190} />
      </div>
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-3xl bg-white shadow-[0_8px_20px_-10px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80"
          >
            <SpeciesIcon3D species={c.patient.species} size={64} />
          </span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-bold tracking-tight text-[#102a43]">{c.patient.name}</span>
              <span className="font-mono text-sm text-slate-400">{c.no}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.priority !== 'Normal' ? <PriorityBadge priority={c.priority} /> : null}
              {c.reviewDueAt ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}
                  title={t('review.workspace.slaTitle', { hours: slaHoursForPriority(c.priority) })}
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t))}
                </span>
              ) : null}
              {c.modality ? (
                <span className="rounded-full bg-teal-600 px-2.5 py-1 text-xs font-bold tracking-wide text-white">
                  {modalityLabel(t, c.modality)}
                </span>
              ) : null}
              {c.anatomicalRegion ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                  <HoloOrgan region={c.anatomicalRegion} size={16} />
                  {regionLabel(t, c.anatomicalRegion)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-vm bg-white shadow-sm ring-1 ring-inset ring-slate-300/90">
            <button
              type="button"
              className={navButton}
              disabled={!hasPrev}
              onClick={onPrev}
              title={t('review.workspace.prevCase')}
              aria-label={t('review.workspace.prevCase')}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-px bg-slate-200" aria-hidden />
            <button
              type="button"
              className={navButton}
              disabled={!hasNext}
              onClick={onNext}
              title={t('review.workspace.nextCase')}
              aria-label={t('review.workspace.nextCase')}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <Button variant="ghost" size="sm" icon={<ImageIcon className="h-3.5 w-3.5" />} onClick={onToggleDicom} aria-pressed={showDicom}>
            {showDicom ? t('review.workspace.hideDicom') : t('review.workspace.showDicom')}
          </Button>
          <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={onSave} disabled={saving || immutable}>
            {saving ? t('review.workspace.savingDraft') : t('review.workspace.saveDraftShortcut')}
          </Button>
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="rounded-2xl bg-white/80 px-3.5 py-2.5 ring-1 ring-slate-200/70 backdrop-blur-sm">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{f.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={f.value}>{f.value}</dd>
          </div>
        ))}
      </dl>

      <p className="relative mt-3 flex items-start gap-2 rounded-2xl bg-white/80 px-3.5 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200/70">
        <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
        <span className="min-w-0">
          <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('review.workspace.caseContext')}</span>
          {clinicalText ? clinicalText : <span className="text-slate-400">{t('review.workspace.noClinicalHistory')}</span>}
          {c.handoffNotes ? <span className="mt-1 block text-xs text-teal-800">Handoff: {c.handoffNotes}</span> : null}
        </span>
      </p>
    </section>
  )
}

export function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold text-navy-900">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">{step}</span>
      {title}
      <span className="h-px flex-1 bg-slate-200" aria-hidden />
    </h2>
  )
}
