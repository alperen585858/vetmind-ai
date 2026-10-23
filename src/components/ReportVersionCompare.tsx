import { useState } from 'react'
import { GitCompare, Loader2 } from 'lucide-react'
import { Card, CardHeader } from './Card'
import { Button } from './Button'
import { getReportVersion } from '../lib/backend'
import type { BackendDraftReport, BackendReportVersionSummary } from '../types'

function sectionDiff(
  a: BackendDraftReport | null,
  b: BackendDraftReport | null,
): { label: string; left: string; right: string; changed: boolean }[] {
  const pairs: [string, string, string][] = [
    ['Teknik', a?.technique?.text ?? '', b?.technique?.text ?? ''],
    ['Bulgular', a?.findings?.text ?? '', b?.findings?.text ?? ''],
    ['Yorum / İzlenim', a?.impression?.text ?? '', b?.impression?.text ?? ''],
    ['Öneriler', a?.recommendations?.text ?? '', b?.recommendations?.text ?? ''],
  ]
  return pairs.map(([label, left, right]) => ({
    label,
    left,
    right,
    changed: left.trim() !== right.trim(),
  }))
}

export function ReportVersionCompare({
  caseId,
  versions,
}: {
  caseId: string
  versions: BackendReportVersionSummary[]
}) {
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const [leftV, setLeftV] = useState(sorted[0]?.version ?? 1)
  const [rightV, setRightV] = useState(sorted[sorted.length - 1]?.version ?? 1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ReturnType<typeof sectionDiff>>([])

  const compare = async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, b] = await Promise.all([getReportVersion(caseId, leftV), getReportVersion(caseId, rightV)])
      setRows(sectionDiff(a.content, b.content))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Karşılaştırma başarısız')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  if (sorted.length < 2) {
    return (
      <Card>
        <CardHeader title="Sürüm karşılaştırma" subtitle="En az iki rapor sürümü gerekir" icon={<GitCompare className="h-5 w-5" />} />
        <p className="px-5 pb-5 text-sm text-slate-500">Onaylı sürümler değiştirilmez; yeni revizyon yeni sürüm açar.</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Sürüm karşılaştırma" subtitle="Onaylı içerik salt okunur" icon={<GitCompare className="h-5 w-5" />} />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
        <label className="text-xs text-slate-600">
          Sol
          <select
            className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={leftV}
            onChange={(e) => setLeftV(Number(e.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.immutable ? ' · kilitli' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Sağ
          <select
            className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={rightV}
            onChange={(e) => setRightV(Number(e.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.immutable ? ' · kilitli' : ''}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => void compare()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Karşılaştır'}
        </Button>
      </div>
      {error && <p className="px-5 pb-2 text-xs text-rose-700">{error}</p>}
      <div className="space-y-3 px-5 pb-5">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2 ${
              r.changed ? 'border-amber-200 bg-amber-50/40' : 'border-slate-100'
            }`}
          >
            <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {r.label}
              {r.changed ? ' · fark var' : ' · aynı'}
            </p>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{r.left || '—'}</pre>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{r.right || '—'}</pre>
          </div>
        ))}
      </div>
    </Card>
  )
}
