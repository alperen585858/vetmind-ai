import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import { Card, CardHeader } from './Card'
import { parseWarnings, type ReviewWarning, type WarningKind } from '../lib/grounding'

const STYLE: Record<WarningKind, string> = {
  overclaim: 'bg-rose-50 text-rose-900',
  unknown_ref: 'bg-rose-50 text-rose-900',
  uncited: 'bg-amber-50 text-amber-900',
  omitted: 'bg-amber-50 text-amber-900',
  system: 'bg-slate-50 text-slate-700',
}

function Item({ w }: { w: ReviewWarning }) {
  const Icon = w.kind === 'overclaim' || w.kind === 'unknown_ref' ? AlertOctagon : AlertTriangle
  return (
    <li className={`flex gap-2 rounded-lg p-3 text-sm ${STYLE[w.kind]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">
          {w.title}
          {w.section && <span className="ml-1.5 font-normal opacity-75">· {w.section}</span>}
        </p>
        <p className="mt-0.5 break-words text-[13px] leading-relaxed">{w.detail}</p>
      </div>
    </li>
  )
}

function isDisclaimerNote(w: { detail: string; raw: string }): boolean {
  return /SENTETİK|klinik doğrulan|tıbbi görüntü|sentetiktir|demo \/ karma|radyolog incelemesi/i.test(
    `${w.detail} ${w.raw}`,
  )
}

/** Validation-layer card: grounding issues first, structural/system notes collapsed. */
export function GroundingWarnings({ warnings, checked }: { warnings?: string[] | null; checked: boolean }) {
  const items = parseWarnings(warnings).filter((w) => !isDisclaimerNote(w))
  const issues = items.filter((w) => w.kind !== 'system')
  const system = items.filter((w) => w.kind === 'system')
  if (!items.length) return null
  return (
    <Card className={issues.length ? 'border-amber-200' : ''}>
      <CardHeader
        title="Doğrulama katmanı"
        subtitle={issues.length ? `${issues.length} konu uzman dikkatini bekliyor` : checked ? 'Atıf ve ifade kontrollerinden geçti' : 'Yapısal kontroller'}
        icon={issues.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
      />
      {issues.length > 0 && (
        <ul className="space-y-2 p-4">
          {issues.map((w) => <Item key={w.raw} w={w} />)}
        </ul>
      )}
      {system.length > 0 && (
        <details className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <Info className="h-3.5 w-3.5" /> Sistem notları ({system.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {system.map((w) => <li key={w.raw}>{w.detail}</li>)}
          </ul>
        </details>
      )}
    </Card>
  )
}
