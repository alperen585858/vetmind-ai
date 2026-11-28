import { AlertCircle, MessageSquare, Plus, Search, Shield, Trash2 } from 'lucide-react'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import type { BackendSupportThreadSummary } from '../../shared/types'
import { avatarTone, channelLabel, initials, listTime, type Filter } from './messageFormat'

/** Left column: title, search, filter chips and the conversation list. */
export function ThreadList({
  subtitle,
  canCompose,
  onCompose,
  query,
  onQuery,
  filters,
  filter,
  onFilter,
  error,
  onRetry,
  loading,
  threads,
  filtered,
  activeThreadId,
  canDelete,
  onDelete,
  onOpen,
}: {
  subtitle: string
  canCompose: boolean
  onCompose: () => void
  query: string
  onQuery: (q: string) => void
  filters: { id: Filter; label: string }[]
  filter: Filter
  onFilter: (f: Filter) => void
  error: string | null
  onRetry: () => void
  loading: boolean
  threads: BackendSupportThreadSummary[]
  filtered: BackendSupportThreadSummary[]
  activeThreadId: string | undefined
  canDelete: (th: BackendSupportThreadSummary) => boolean
  onDelete: (threadId: string) => void
  onOpen: (threadId: string) => void
}) {
  const { t, locale } = useLocale()
  return (
    <>
      <div className="space-y-3 border-b border-slate-100 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-navy-950">{t('messages.title')}</h1>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
          {canCompose && (
            <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={onCompose} icon={<Plus className="h-4 w-4" />}>
              {t('messages.newMessage')}
            </Button>
          )}
        </div>
        <label className="relative block">
          <span className="sr-only">{t('messages.searchPlaceholder')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('messages.searchPlaceholder')}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-navy-900 outline-none placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
          />
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label={t('messages.filterLabel')}>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                filter === f.id ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={onRetry}>
            {t('messages.retry')}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="space-y-1 p-3" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex animate-pulse items-center gap-3 rounded-xl px-2 py-2.5">
                <div className="h-10 w-10 rounded-full bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 rounded bg-slate-100" />
                  <div className="h-3 w-3/4 rounded bg-slate-100" />
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <MessageSquare className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-semibold text-navy-950">
              {threads.length === 0 ? t('messages.noMessages') : t('messages.noMatches')}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {threads.length === 0
                ? canCompose
                  ? t('messages.emptyListHintStaff')
                  : t('messages.emptyListHintInbox')
                : t('messages.noMatchesHint')}
            </p>
            {canCompose && threads.length === 0 && (
              <Button size="sm" className="mt-4" onClick={onCompose} icon={<Plus className="h-4 w-4" />}>
                {t('messages.newMessage')}
              </Button>
            )}
          </div>
        ) : (
          <ul className="p-2">
            {filtered.map((th) => {
              const active = activeThreadId === th.thread_id
              const name = th.counterpart_name || channelLabel(th.channel, t)
              const unread = th.unread_count > 0
              return (
                <li key={th.thread_id} className="group/row relative">
                  {canDelete(th) && (
                    <button
                      type="button"
                      onClick={() => onDelete(th.thread_id)}
                      className="absolute bottom-2 right-2 z-10 rounded-lg bg-white p-1.5 text-slate-400 opacity-0 shadow-sm ring-1 ring-slate-200 transition hover:text-rose-600 focus:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-80"
                      title={t('messages.deleteThread')}
                      aria-label={`${t('messages.deleteThread')}: ${th.counterpart_name || th.subject}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpen(th.thread_id)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                      active ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${avatarTone(th.counterpart_role)}`}>
                        {th.counterpart_role === 'support' ? <Shield className="h-4 w-4" /> : initials(name)}
                      </span>
                      {th.counterpart_online && (
                        <span
                          className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
                          title={t('messages.online')}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${unread ? 'font-bold text-navy-950' : 'font-semibold text-navy-900'}`}>{name}</span>
                        <span className={`shrink-0 text-[11px] ${unread ? 'font-semibold text-teal-700' : 'text-slate-400'}`}>
                          {listTime(th.last_message_at || th.updated_at, locale, t)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`min-w-0 flex-1 truncate text-xs ${unread ? 'text-navy-800' : 'text-slate-500'}`}>
                          <span className="font-medium">{th.subject}</span>
                          {th.last_message_preview ? ` — ${th.last_message_preview}` : ''}
                        </span>
                        {unread && (
                          <span
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white"
                            aria-label={t('messages.unreadCount', { count: th.unread_count })}
                          >
                            {th.unread_count}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
