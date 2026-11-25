import { Fragment, useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, RefreshCw, X } from 'lucide-react'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Button } from '../../shared/ui/Button'
import { useLocale } from '../../shared/shell/LocaleContext'
import {
  fetchArchitecture,
  type ArchitectureNode,
  type ArchitectureResponse,
  type ArchitectureStatus,
} from '../../shared/api'

const REFRESH_MS = 15_000

const STATUS_STYLE: Record<ArchitectureStatus, { box: string; dot: string }> = {
  active: { box: 'border-emerald-400/70 bg-[#0b2a4a]', dot: 'bg-emerald-400' },
  mock: { box: 'border-amber-400/70 bg-[#0b2a4a]', dot: 'bg-amber-400' },
  fallback: { box: 'border-orange-500/80 bg-[#0b2a4a]', dot: 'bg-orange-500' },
  off: { box: 'border-dashed border-slate-500/70 bg-[#0a1e33] opacity-70', dot: 'bg-slate-500' },
}

function DownArrow() {
  return (
    <div className="flex justify-center py-1.5" aria-hidden>
      <div className="flex flex-col items-center text-slate-500">
        <div className="h-4 w-px bg-slate-500" />
        <ArrowDown className="-mt-1 h-3.5 w-3.5" />
      </div>
    </div>
  )
}

function NodeBox({
  node,
  selected,
  onSelect,
  statusLabel,
  usesLabel,
}: {
  node: ArchitectureNode
  selected: boolean
  onSelect: (id: string) => void
  statusLabel: string
  usesLabel: (n: number) => string
}) {
  const style = STATUS_STYLE[node.status]
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={`w-full max-w-[300px] rounded-2xl border-2 px-4 py-3 text-center shadow-lg transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${style.box} ${
        selected ? 'ring-2 ring-sky-300' : ''
      }`}
    >
      <span className="flex items-center justify-center gap-2 text-sm font-semibold text-[#cfe3ff]">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} title={statusLabel} />
        {node.label}
      </span>
      {node.detail ? <span className="mt-1 block text-xs text-[#8fb3d9]">{node.detail}</span> : null}
      {typeof node.recent_uses === 'number' && node.recent_uses > 0 ? (
        <span className="mt-1.5 inline-block rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium text-sky-200">
          {usesLabel(node.recent_uses)}
        </span>
      ) : null}
    </button>
  )
}

export default function AiArchitecture() {
  const { t } = useLocale()
  const [data, setData] = useState<ArchitectureResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchArchitecture()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('architecture.loadFail')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const statusLabel = (s: ArchitectureStatus) => t(`architecture.status.${s}`)
  const usesLabel = (n: number) => t('architecture.uses', { n })
  const selected = selectedId && data ? data.nodes[selectedId] : null
  const side = new Set(data?.side_nodes ?? [])

  return (
    <>
      <PageHeader
        title={t('architecture.title')}
        subtitle={t('architecture.subtitle')}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />} onClick={load}>
            {t('architecture.refresh')}
          </Button>
        }
      />

      {/* Legend + summary */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        {(['active', 'mock', 'fallback', 'off'] as ArchitectureStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[s].dot}`} />
            {statusLabel(s)}
          </span>
        ))}
        {data ? (
          <span className="ml-auto text-xs text-slate-500">
            {t('architecture.updated')} {new Date(data.generated_at).toLocaleTimeString()} ·{' '}
            {t('architecture.recentJobs', { n: data.summary.recent_jobs })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto rounded-[1.25rem] bg-[#020b16] px-4 py-6 sm:px-8">
          {!data ? (
            <p className="py-20 text-center text-sm text-slate-400">{t('architecture.loading')}</p>
          ) : (
            <div className="mx-auto min-w-[640px] max-w-5xl">
              {data.rows.map((row, i) => {
                const main = row.filter((id) => !side.has(id))
                const sideIds = row.filter((id) => side.has(id))
                const isBranch = main.length > 1 && main.every((id) => data.nodes[id]?.branch_label)
                return (
                  <Fragment key={row.join('-')}>
                    {i > 0 ? <DownArrow /> : null}
                    {sideIds.length > 0 ? (
                      // Main node in the centre, side input (RAG) to its right with a dashed arrow.
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div />
                        <div className="flex justify-center">
                          {main.map((id) => (
                            <NodeBox key={id} node={data.nodes[id]} selected={selectedId === id} onSelect={setSelectedId} statusLabel={statusLabel(data.nodes[id].status)} usesLabel={usesLabel} />
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowLeft className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                          <div className="h-px w-6 border-t border-dashed border-slate-500" aria-hidden />
                          {sideIds.map((id) => (
                            <NodeBox key={id} node={data.nodes[id]} selected={selectedId === id} onSelect={setSelectedId} statusLabel={statusLabel(data.nodes[id].status)} usesLabel={usesLabel} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className={`grid gap-3 ${main.length > 1 ? '' : 'justify-items-center'}`} style={main.length > 1 ? { gridTemplateColumns: `repeat(${main.length}, minmax(0, 1fr))` } : undefined}>
                        {main.map((id) => {
                          const node = data.nodes[id]
                          return (
                            <div key={id} className="flex flex-col items-center">
                              {isBranch ? (
                                <span className="mb-2 rounded-full border border-slate-600 bg-[#06182b] px-3 py-0.5 text-xs font-semibold text-[#cfe3ff]">
                                  {node.branch_label}
                                </span>
                              ) : null}
                              <NodeBox node={node} selected={selectedId === id} onSelect={setSelectedId} statusLabel={statusLabel(node.status)} usesLabel={usesLabel} />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>

        {/* Details of the clicked box */}
        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-soft">
            {selected ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-navy-900">{selected.label}</h2>
                    <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[selected.status].dot}`} />
                      {statusLabel(selected.status)}
                      {selected.branch_label ? ` · ${selected.branch_label}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => setSelectedId(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label={t('architecture.close')}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {selected.detail ? <p className="mt-3 text-sm text-slate-700">{selected.detail}</p> : null}
                {Object.keys(selected.info).length > 0 ? (
                  <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
                    {Object.entries(selected.info).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-slate-400">{k}</dt>
                        <dd className="break-words text-navy-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {selected.code && selected.code.length > 0 ? (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-400">{t('architecture.code')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {selected.code.map((path) => (
                        <li key={path} className="break-all font-mono text-[11px] text-slate-600">{path}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">{t('architecture.pickNode')}</p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
