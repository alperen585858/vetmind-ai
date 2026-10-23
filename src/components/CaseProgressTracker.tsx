import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { CaseStatus } from '../types'

const STEPS: { key: string; label: string; match: (s: CaseStatus) => boolean; done: (s: CaseStatus) => boolean }[] = [
  {
    key: 'created',
    label: 'Oluşturuldu',
    match: () => false,
    done: () => true,
  },
  {
    key: 'submitted',
    label: 'Görüntü / öykü',
    match: (s) => s === 'taslak' || s === 'ai_analizi',
    done: (s) => !['taslak'].includes(s),
  },
  {
    key: 'analyze',
    label: 'Analiz',
    match: (s) => s === 'ai_analizi',
    done: (s) =>
      ['uzman_incelemesinde', 'manuel_inceleme', 'onaylandi', 'reddedildi', 'revizyon', 'analiz_basarisiz'].includes(s),
  },
  {
    key: 'review',
    label: 'Radyolog inceleme',
    match: (s) => s === 'uzman_incelemesinde' || s === 'revizyon' || s === 'manuel_inceleme',
    done: (s) => s === 'onaylandi' || s === 'reddedildi',
  },
  {
    key: 'final',
    label: 'Sonuç',
    match: (s) => s === 'onaylandi' || s === 'reddedildi',
    done: (s) => s === 'onaylandi' || s === 'reddedildi',
  },
]

export function CaseProgressTracker({
  status,
  handoffNotes,
}: {
  status: CaseStatus
  handoffNotes?: string | null
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Vaka ilerleme</p>
      <ol className="space-y-2">
        {STEPS.map((step) => {
          const isDone = step.done(status)
          const isActive = step.match(status)
          return (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              {isDone && !isActive ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
              ) : (
                <Circle className="h-4 w-4 text-slate-300" />
              )}
              <span className={isActive ? 'font-semibold text-navy-900' : isDone ? 'text-slate-700' : 'text-slate-400'}>
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
      {handoffNotes ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          <span className="font-semibold text-navy-800">Klinik not: </span>
          {handoffNotes}
        </p>
      ) : null}
    </div>
  )
}
