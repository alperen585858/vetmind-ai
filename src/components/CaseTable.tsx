import { useEffect, useMemo, useState } from 'react'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Image as ImageIcon,
  MoreHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { analysisStatusLabel, expertReviewLabel } from '../lib/caseMapper'
import { fmtDate } from '../lib/format'
import { useLocale } from '../context/LocaleContext'
import type { TranslateFn } from '../i18n'

const SPECIES_EMOJI: Record<string, string> = { Kedi: '🐱', Köpek: '🐶' }

const MODALITY_CLS: Record<string, string> = {
  MR: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  CT: 'bg-violet-50 text-violet-700 ring-violet-200',
  XR: 'bg-sky-50 text-sky-700 ring-sky-200',
  OTHER: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function SpeciesIcon({ species }: { species: string }) {
  return (
    <span className="text-base leading-none" role="img" aria-label={species}>
      {SPECIES_EMOJI[species] ?? '🐾'}
    </span>
  )
}

function studyCell(c: VetCase, t: TranslateFn): string {
  if (c.instanceCount != null || c.seriesCount != null) {
    const parts = [
      c.seriesCount != null ? t('cases.seriesShort', { n: c.seriesCount }) : null,
      c.instanceCount != null ? t('cases.imagesShort', { n: c.instanceCount }) : null,
    ].filter(Boolean)
    return parts.join(' · ') || t('common.dash')
  }
  if (c.studyInstanceUid) return `UID …${c.studyInstanceUid.slice(-8)}`
  if (c.documents.some((d) => d.name.toUpperCase().includes('DICOM'))) return 'DICOM'
  return t('common.dash')
}

function modalityLabel(c: VetCase, dash: string): string {
  if (!c.modality) return dash
  return c.anatomicalRegion ? `${c.modality}-${c.anatomicalRegion}` : c.modality
}

function AnalysisCell({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const label = analysisStatusLabel(c.status, t)
  if (c.status === 'analiz_basarisiz') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('status.analiz_basarisiz')}
      </span>
    )
  }
  if (
    c.status === 'uzman_incelemesinde' ||
    c.status === 'onaylandi' ||
    c.status === 'reddedildi' ||
    c.status === 'revizyon'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('analysis.aiCompleted')}
      </span>
    )
  }
  return <span className="text-xs text-slate-600">{label}</span>
}

function expertDisplay(c: VetCase, t: TranslateFn): string {
  if (c.assignedReviewerId) {
    const id = c.assignedReviewerId
    if (id.includes('@')) return id.split('@')[0]
    return id
  }
  const review = expertReviewLabel(c.status, t)
  return review === t('common.dash') ? t('cases.unassigned') : review
}

export function CaseTable({
  cases,
  showPriority = false,
  selectable = true,
  onDelete,
  onBulkDelete,
}: {
  cases: VetCase[]
  showPriority?: boolean
  selectable?: boolean
  /** When set, shows a delete control (caller must confirm). */
  onDelete?: (c: VetCase) => void
  /** When set with selectable, shows bulk delete for checked rows (caller must confirm). */
  onBulkDelete?: (cases: VetCase[]) => void
}) {
  const nav = useLocalizedNavigate()
  const { t, locale } = useLocale()
  const dash = t('common.dash')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allIds = useMemo(() => cases.map((c) => c.id), [cases])
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const selectedCases = useMemo(() => cases.filter((c) => selected.has(c.id)), [cases, selected])
  const canBulk = Boolean(onBulkDelete) && selectable

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => allIds.includes(id)))
      return next.size === prev.size ? prev : next
    })
  }, [allIds])

  const toggleAll = () => {
    setSelected((prev) => {
      if (allIds.every((id) => prev.has(id))) return new Set()
      return new Set(allIds)
    })
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      {canBulk && selectedCases.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-100 bg-rose-50/80 px-4 py-2.5 sm:px-5">
          <p className="text-sm font-medium text-rose-950">
            {t('cases.bulkSelected', { count: selectedCases.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
              onClick={() => setSelected(new Set())}
            >
              {t('cases.clearSelection')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800"
              onClick={() => onBulkDelete?.(selectedCases)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('cases.deleteSelected')}
            </button>
          </div>
        </div>
      )}
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/80">
          <tr>
            {selectable && (
              <th className="th w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('cases.selectAll')}
                />
              </th>
            )}
            <th className="th">{t('cases.caseNo')}</th>
            <th className="th">{t('cases.patient')}</th>
            <th className="th">{t('cases.speciesBreed')}</th>
            <th className="th">{t('cases.modality')}</th>
            <th className="th">{t('cases.study')}</th>
            <th className="th">{t('cases.analysisCol')}</th>
            <th className="th">{t('cases.expert')}</th>
            {showPriority && <th className="th">{t('common.priority')}</th>}
            <th className="th">{t('common.status')}</th>
            <th className="th">{t('common.date')}</th>
            <th className="th text-right">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cases.map((c) => (
            <tr
              key={c.id}
              onClick={() => nav(`/vakalar/${c.id}`)}
              className="cursor-pointer transition hover:bg-teal-50/40"
            >
              {selectable && (
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={selected.has(c.id)}
                    onChange={() => toggleOne(c.id)}
                    aria-label={t('cases.selectCase', { no: c.no })}
                  />
                </td>
              )}
              <td className="td font-mono text-[11px] font-semibold text-slate-500" title={c.id}>
                {c.no}
              </td>
              <td className="td">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-50 to-sky-50 text-lg ring-1 ring-slate-200/80">
                    <SpeciesIcon species={c.patient.species} />
                  </span>
                  <span className="font-semibold text-navy-900">{c.patient.name}</span>
                </div>
              </td>
              <td className="td">
                <div className="text-sm text-navy-800">{c.patient.species}</div>
                <div className="text-xs text-slate-500">{c.patient.breed}</div>
              </td>
              <td className="td">
                <span
                  className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    MODALITY_CLS[c.modality ?? 'OTHER'] ?? MODALITY_CLS.OTHER
                  }`}
                >
                  {modalityLabel(c, dash)}
                </span>
              </td>
              <td className="td" title={c.studyInstanceUid}>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <FolderOpen className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {studyCell(c, t)}
                </span>
              </td>
              <td className="td">
                <AnalysisCell c={c} />
              </td>
              <td className="td text-xs text-slate-700">{expertDisplay(c, t)}</td>
              {showPriority && (
                <td className="td">
                  <PriorityBadge priority={c.priority} />
                </td>
              )}
              <td className="td">
                <StatusBadge status={c.status} />
              </td>
              <td className="td text-xs text-slate-500">{fmtDate(c.createdAt, locale)}</td>
              <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-100"
                    onClick={() => nav(`/vakalar/${c.id}?tab=goruntu`)}
                    aria-label={t('cases.viewDicomAria', { no: c.no })}
                    title={t('cases.viewDicom')}
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                    {t('common.view')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    onClick={() => nav(`/vakalar/${c.id}`)}
                  >
                    {t('cases.open')} <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  {onDelete ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => onDelete(c)}
                      aria-label={t('cases.deleteCaseAria', { no: c.no })}
                      title={t('cases.deleteCaseTitle')}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t('common.delete')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                      aria-label={t('cases.moreActions')}
                      onClick={() => nav(`/vakalar/${c.id}`)}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  )
}
