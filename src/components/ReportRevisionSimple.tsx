import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getReportVersion } from '../lib/backend'
import { sectionDiff } from './ReportVersionCompare'
import type { BackendReportVersionSummary } from '../types'

/** Minimal previous-vs-current view: only changed sections, no dropdowns. */
export function ReportRevisionSimple({
  caseId,
  versions,
}: {
  caseId: string
  versions: BackendReportVersionSummary[]
}) {
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const prev = sorted[0]
  const current = sorted[sorted.length - 1]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState<ReturnType<typeof sectionDiff>>([])

  useEffect(() => {
    if (!prev || !current || prev.version === current.version) {
      setLoading(false)
      setChanged([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([getReportVersion(caseId, prev.version), getReportVersion(caseId, current.version)])
      .then(([a, b]) => {
        if (cancelled) return
        setChanged(sectionDiff(a.content, b.content).filter((r) => r.changed))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Yüklenemedi')
        setChanged([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [caseId, prev?.version, current?.version])

  if (!prev || !current || prev.version === current.version) return null

  return (
    <div className="rounded-xl border border-violet-200 bg-white shadow-soft">
      <div className="border-b border-violet-100 px-5 py-3">
        <p className="text-sm font-semibold text-navy-900">Ne değişti?</p>
        <p className="text-xs text-slate-500">
          v{prev.version} → v{current.version} · sadece fark olan bölümler
        </p>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </p>
        ) : error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : changed.length === 0 ? (
          <p className="text-sm text-slate-500">Metin aynı görünüyor (sürüm kaydı var).</p>
        ) : (
          <ul className="space-y-4">
            {changed.map((r) => (
              <li key={r.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-800">{r.label}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="mb-1 text-[11px] font-medium text-slate-500">Önceki</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{r.left || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-violet-50 p-3">
                    <p className="mb-1 text-[11px] font-medium text-violet-700">Revize</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{r.right || '—'}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
