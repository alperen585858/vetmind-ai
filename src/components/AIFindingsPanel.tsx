import { Bot } from 'lucide-react'
import type { BackendFindings } from '../types'
import { ProvenanceBanner, provenanceKindFromSource } from './ProvenanceBanner'

/**
 * Placeholder / read-only AI findings surface for the radiologist workspace.
 * Never invents clinical findings. Shows NOT CONFIGURED when no REAL model path.
 */
export function AIFindingsPanel({
  findings,
  analysisMode,
}: {
  findings?: BackendFindings | null
  analysisMode?: string | null
}) {
  const realConfigured = analysisMode === 'real' || analysisMode === 'mixed'
  const items = findings?.findings ?? []
  const kind = realConfigured
    ? provenanceKindFromSource(findings?.source_kind, {
        synthetic: findings?.findings?.some((f) => f.synthetic),
        analysisMode,
      })
    : 'not_configured'

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
        <Bot className="h-4 w-4 text-teal-700" aria-hidden />
        AI Bulgular
      </div>
      <ProvenanceBanner kind={kind} compact />
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Gösterilecek AI bulgusu yok — bulgu uydurulmaz.</p>
      ) : (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
          {items.map((f) => (
            <li key={f.finding_id} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
              <p className="font-medium text-navy-900">{f.finding_code}</p>
              <p className="mt-0.5 text-slate-600">{f.description}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                {f.synthetic ? 'SYNTHETIC/MOCK' : f.source_model} · review required
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
