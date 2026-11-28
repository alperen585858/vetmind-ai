import { ArrowLeft, ExternalLink, Shield, Trash2 } from 'lucide-react'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocale } from '../../shared/shell/LocaleContext'
import type { BackendSupportThreadSummary, SupportMessageChannel } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { LEGACY_DEMO_SUBJECTS, avatarTone, dayLabel, initials, roleLabel, type Group, type UiMessage } from './messageFormat'

/** Open conversation header: back (mobile), counterpart, presence / typing, case link, delete. */
export function ChatHeader({
  thread,
  counterpartName,
  typing,
  canDelete,
  onBack,
  onDelete,
}: {
  thread: BackendSupportThreadSummary
  counterpartName: string
  typing: boolean
  canDelete: boolean
  onBack: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-navy-800 hover:bg-slate-100 lg:hidden"
        onClick={onBack}
        aria-label={t('messages.backToThreads')}
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <span className="relative shrink-0">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${avatarTone(thread.counterpart_role)}`}>
          {thread.counterpart_role === 'support' ? <Shield className="h-4 w-4" /> : initials(counterpartName)}
        </span>
        {thread.counterpart_online && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-navy-950">{counterpartName}</p>
        <p className="truncate text-xs text-slate-500" aria-live="polite">
          {typing ? (
            <span className="font-medium text-teal-700">{t('messages.typing')}</span>
          ) : (
            <>
              {thread.counterpart_online ? (
                <span className="font-medium text-emerald-700">{t('messages.online')}</span>
              ) : (
                roleLabel(thread.counterpart_role || '', t)
              )}
              {` · ${thread.subject}`}
            </>
          )}
        </p>
      </div>
      {thread.related_case_id && (
        <LocalizedLink
          to={`/vakalar/${thread.related_case_id}`}
          className="hidden items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 sm:inline-flex"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t('messages.goToCase')}
        </LocalizedLink>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-50"
          title={t('messages.deleteThread')}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t('messages.deleteThread')}</span>
          <span className="sr-only sm:hidden">{t('messages.deleteThread')}</span>
        </button>
      )}
    </header>
  )
}

/** Day-grouped message runs plus the "typing…" indicator. */
export function MessageLog({
  groups,
  me,
  role,
  channel,
  counterpartName,
  typingName,
  onDelete,
  onRestore,
  onRetry,
  onDiscard,
}: {
  groups: Group[]
  me: string
  role: string | null | undefined
  channel: SupportMessageChannel
  counterpartName: string
  typingName: string | null
  onDelete: (m: UiMessage) => void
  onRestore: (m: UiMessage) => void
  onRetry: (m: UiMessage) => void
  onDiscard: (m: UiMessage) => void
}) {
  const { t, locale } = useLocale()
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {groups.map((g) => (
        <div key={g.day} className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium text-slate-500">{dayLabel(g.runs[0].items[0].created_at, locale, t)}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          {g.runs.map((run, ri) => {
            const mine = run.author === me
            const name = run.role === 'admin' && channel === 'admin' ? t('messages.roleSupport') : counterpartName
            return (
              <div key={`${g.day}-${ri}`} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                {!mine && (
                  <span className={`mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${avatarTone(run.role)}`}>
                    {initials(name || run.author)}
                  </span>
                )}
                <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
                  {!mine && (
                    <span className="px-1 text-[11px] font-semibold text-slate-600">
                      {name} <span className="font-normal text-slate-400">· {roleLabel(run.role, t)}</span>
                    </span>
                  )}
                  {run.items.map((m) => (
                    <MessageBubble
                      key={m.localId || m.message_id}
                      m={m}
                      mine={mine}
                      canDelete={(mine || role === 'admin' || LEGACY_DEMO_SUBJECTS.has(m.author_subject)) && !m.localState}
                      onDelete={() => onDelete(m)}
                      onRestore={() => onRestore(m)}
                      onRetry={() => onRetry(m)}
                      onDiscard={() => onDiscard(m)}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {typingName && (
        <div className="flex items-center gap-2 pl-9 text-xs text-slate-500">
          <span className="flex gap-0.5" aria-hidden>
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
          </span>
          {t('messages.typingNamed', { name: typingName })}
        </div>
      )}
    </div>
  )
}
