import { BookOpen } from 'lucide-react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { RagCitations } from '../../../shared/ui/RagCitations'
import { EmptyState } from '../../../shared/ui/EmptyState'
import type { VetCase } from '../../../shared/types'

export function SourcesView({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const ai = c.ai
  const sourceIds = ai
    ? Array.from(
        new Set([
          ...ai.differentials.flatMap((d) => d.citations),
          ...ai.findings.flatMap((f) => f.citations ?? []),
          ...ai.validation.flatMap((v) => v.citations ?? []),
        ]),
      ).sort((a, b) => a - b)
    : []
  const ragCitations = c.backendDraft?.rag_citations

  return (
    <Card>
      <CardHeader
        title={t('cases.detail.sourcesRag')}
        subtitle={ragCitations?.length ? t('cases.detail.sourcesUsed') : t('cases.detail.sourcesAvailable')}
        icon={<BookOpen className="h-5 w-5" />}
      />
      {ragCitations?.length ? (
        <RagCitations
          citations={ragCitations}
          note={c.backendDraft?.rag_note}
          citationMap={c.backendDraft?.citation_map}
          usedPassageIds={c.backendDraft?.used_passage_ids}
        />
      ) : sourceIds.length ? (
        <SourceList ids={sourceIds} />
      ) : (
        <div className="p-5">
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={t('cases.detail.noCitations')}
            text={t('cases.detail.noCitationsBody')}
          />
        </div>
      )}
    </Card>
  )
}

function SourceList({ ids }: { ids: number[] }) {
  const { t } = useLocale()
  const { kbSources, openSource } = useApp()
  const sources = ids
    .map((id) => ({ id, source: kbSources.find((item) => item.id === id) }))
    .filter((item): item is { id: number; source: (typeof kbSources)[number] } => Boolean(item.source))

  if (!sources.length) {
    return (
      <div className="p-5">
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('cases.detail.noSourceRecord')}
          text={t('cases.detail.noSourceRecordBody')}
        />
      </div>
    )
  }

  return (
    <ul className="divide-y divide-slate-100">
      {sources.map(({ id, source }) => {
        return (
          <li key={id}>
            <button onClick={() => openSource(id)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
              <span className="mt-0.5 rounded bg-teal-50 px-1.5 text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">[{id}]</span>
              <span>
                <span className="block text-sm font-medium text-navy-900">{source.title}</span>
                <span className="block text-xs text-slate-500">{source.type} · {source.section}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
