import { Bot, CircleSlash2 } from 'lucide-react'
import type { BackendFindings } from '../types'
import { AIDisclaimer } from './AIDisclaimer'

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

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
        <Bot className="h-4 w-4 text-teal-700" />
        AI Bulgular
        {!realConfigured && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
            Not configured
          </span>
        )}
      </div>
      <AIDisclaimer compact />
      {!realConfigured && (
        <p className="mt-2 flex items-start gap-2 text-xs text-amber-900">
          <CircleSlash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Gerçek Vision modeli bağlı değil. Bu panel entegrasyon yer tutucusudur; klinik bulgu
          uydurulmaz. Mock çıktılar varsa yalnızca pipeline testi içindir.
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Gösterilecek AI bulgusu yok.</p>
      ) : (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
          {items.map((f) => (
            <li key={f.finding_id} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
              <p className="font-medium text-navy-900">{f.finding_code}</p>
              <p className="mt-0.5 text-slate-600">{f.description}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                {f.synthetic ? 'synthetic/mock' : f.source_model} · review required
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
