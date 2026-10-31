import { Bot } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'
import { displayFindingCode, displayFindingDescription } from '../lib/displayClean'
import type { BackendFindings } from '../types'

/** Read-only AI findings for the radiologist workspace. */
export function AIFindingsPanel({
  findings,
}: {
  findings?: BackendFindings | null
  analysisMode?: string | null
}) {
  const { t } = useLocale()
  const items = findings?.findings ?? []

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
        <Bot className="h-4 w-4 text-teal-700" aria-hidden />
        {t('ai.findings')}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">{t('ai.findingsEmpty')}</p>
      ) : (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
          {items.map((f) => (
            <li key={f.finding_id} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
              <p className="font-medium text-navy-900">{displayFindingCode(f.finding_code)}</p>
              <p className="mt-0.5 text-slate-600">{displayFindingDescription(f.description)}</p>
              {f.anatomical_location ? (
                <p className="mt-1 text-[10px] text-slate-400">
                  {displayFindingDescription(f.anatomical_location)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
