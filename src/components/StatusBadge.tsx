import type { CaseStatus, Priority, Severity } from '../types'

export const STATUS_META: Record<CaseStatus, { label: string; cls: string; dot: string }> = {
  taslak: { label: 'Taslak', cls: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  isleniyor: { label: 'Belgeler İşleniyor', cls: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500 animate-pulse' },
  ai_analizi: { label: 'AI Analizi', cls: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500 animate-pulse' },
  uzman_incelemesinde: { label: 'Uzman İncelemesinde', cls: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  onaylandi: { label: 'Onaylandı', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  reddedildi: { label: 'Reddedildi', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  revizyon: { label: 'Revizyon İstendi', cls: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  analiz_basarisiz: { label: 'Analiz Başarısız', cls: 'bg-rose-50 text-rose-800 ring-rose-300', dot: 'bg-rose-600' },
  manuel_inceleme: { label: 'Manuel İnceleme', cls: 'bg-slate-100 text-slate-800 ring-slate-300', dot: 'bg-slate-600' },
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

export function StatusBadge({ status }: { status: CaseStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = {
    STAT: 'bg-rose-800 text-white ring-1 ring-rose-900',
    Acil: 'bg-rose-600 text-white',
    Yüksek: 'bg-orange-100 text-orange-800',
    Normal: 'bg-slate-100 text-slate-600',
  }[priority]
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {priority}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const cls = { Yüksek: 'bg-rose-50 text-rose-700 ring-rose-200', Orta: 'bg-amber-50 text-amber-800 ring-amber-200', Düşük: 'bg-sky-50 text-sky-700 ring-sky-200' }[severity]
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{severity}</span>
}
