import type { CaseStatus, Priority, Severity } from '../types'
import { useLocale } from '../context/LocaleContext'
import type { TranslateFn } from '../i18n'

export const STATUS_META: Record<CaseStatus, { labelKey: string; cls: string; dot: string }> = {
  taslak: { labelKey: 'status.taslak', cls: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  isleniyor: { labelKey: 'status.isleniyor', cls: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500 animate-pulse' },
  ai_analizi: { labelKey: 'status.ai_analizi', cls: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500 animate-pulse' },
  uzman_incelemesinde: { labelKey: 'status.uzman_incelemesinde', cls: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  onaylandi: { labelKey: 'status.onaylandi', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  reddedildi: { labelKey: 'status.reddedildi', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  revizyon: { labelKey: 'status.revizyon', cls: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  analiz_basarisiz: { labelKey: 'status.analiz_basarisiz', cls: 'bg-rose-50 text-rose-800 ring-rose-300', dot: 'bg-rose-600' },
  manuel_inceleme: { labelKey: 'status.manuel_inceleme', cls: 'bg-slate-100 text-slate-800 ring-slate-300', dot: 'bg-slate-600' },
}

export const STATUS_ORDER: CaseStatus[] = [
  'taslak',
  'isleniyor',
  'ai_analizi',
  'uzman_incelemesinde',
  'manuel_inceleme',
  'analiz_basarisiz',
  'onaylandi',
  'reddedildi',
  'revizyon',
]

export function statusLabel(status: CaseStatus, t: TranslateFn): string {
  return t(STATUS_META[status].labelKey)
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const { t } = useLocale()
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {t(m.labelKey)}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useLocale()
  const cls = {
    STAT: 'bg-rose-800 text-white ring-1 ring-rose-900',
    Acil: 'bg-rose-600 text-white',
    Yüksek: 'bg-orange-100 text-orange-800',
    Normal: 'bg-slate-100 text-slate-600',
  }[priority]
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {t(`priority.${priority}`)}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useLocale()
  const cls = { Yüksek: 'bg-rose-50 text-rose-700 ring-rose-200', Orta: 'bg-amber-50 text-amber-800 ring-amber-200', Düşük: 'bg-sky-50 text-sky-700 ring-sky-200' }[severity]
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {t(`severity.${severity}`)}
    </span>
  )
}
