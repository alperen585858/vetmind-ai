import { useEffect, useState } from 'react'
import { GitCompare, Loader2 } from 'lucide-react'
import { Card, CardHeader } from './Card'
import { Button } from './Button'
import { getReportVersion } from '../lib/backend'
import type { BackendDraftReport, BackendReportVersionSummary } from '../types'

export function sectionDiff(
  a: BackendDraftReport | null,
  b: BackendDraftReport | null,
): { label: string; left: string; right: string; changed: boolean }[] {
  const pairs: [string, string, string][] = [
    ['Teknik / Klinik özet', a?.technique?.text ?? '', b?.technique?.text ?? ''],
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
  autoCompare = false,
  leftLabel = 'Önceki',
  rightLabel = 'Güncel / revize',
}: {
  caseId: string
  versions: BackendReportVersionSummary[]
  /** Run comparison as soon as two versions exist (approved report page). */
  autoCompare?: boolean
  leftLabel?: string
  rightLabel?: string
}) {
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const [leftV, setLeftV] = useState(sorted[0]?.version ?? 1)
  const [rightV, setRightV] = useState(sorted[sorted.length - 1]?.version ?? 1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ReturnType<typeof sectionDiff>>([])

  const compare = async (left = leftV, right = rightV) => {
    setLoading(true)
    setError(null)
    try {
      const [a, b] = await Promise.all([getReportVersion(caseId, left), getReportVersion(caseId, right)])
      setRows(sectionDiff(a.content, b.content))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Karşılaştırma başarısız')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!autoCompare || sorted.length < 2) return
    const left = sorted[0]?.version
    const right = sorted[sorted.length - 1]?.version
    if (left == null || right == null || left === right) return
    setLeftV(left)
    setRightV(right)
    void compare(left, right)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when case/versions change
  }, [autoCompare, caseId, sorted.map((v) => v.version).join(',')])

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
      <CardHeader
        title="Önceki ve revize edilmiş sürüm"
        subtitle={`${leftLabel} (v${leftV}) · ${rightLabel} (v${rightV})`}
        icon={<GitCompare className="h-5 w-5" />}
      />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
        <label className="text-xs text-slate-600">
          {leftLabel}
          <select
            className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={leftV}
            onChange={(e) => setLeftV(Number(e.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.immutable ? ' · kilitli' : ''}
                {v.status === 'approved' ? ' · onaylı' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          {rightLabel}
          <select
            className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={rightV}
            onChange={(e) => setRightV(Number(e.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.immutable ? ' · kilitli' : ''}
                {v.status === 'approved' ? ' · onaylı' : ''}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => void compare()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Karşılaştır'}
        </Button>
      </div>
      {error && <p className="px-5 pb-2 text-xs text-rose-700">{error}</p>}
      {loading && !rows.length ? (
        <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Sürümler yükleniyor…
        </p>
      ) : (
        <div className="space-y-3 px-5 pb-5">
          <div className="hidden grid-cols-2 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
            <span>
              {leftLabel} · v{leftV}
            </span>
            <span>
              {rightLabel} · v{rightV}
            </span>
          </div>
          {rows.map((r) => (
            <div
              key={r.label}
              className={`grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2 ${
                r.changed ? 'border-violet-200 bg-violet-50/50' : 'border-slate-100'
              }`}
            >
              <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {r.label}
                {r.changed ? ' · fark var' : ' · aynı'}
              </p>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase text-slate-400 sm:hidden">
                  {leftLabel} v{leftV}
                </p>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700">{r.left || '—'}</pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase text-violet-600 sm:hidden">
                  {rightLabel} v{rightV}
                </p>
                <pre
                  className={`whitespace-pre-wrap font-sans text-xs leading-relaxed ${
                    r.changed ? 'text-navy-900' : 'text-slate-700'
                  }`}
                >
                  {r.right || '—'}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
