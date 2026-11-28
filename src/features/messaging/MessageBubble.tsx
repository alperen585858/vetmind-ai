import { useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCheck, Clock, RotateCcw, Trash2 } from 'lucide-react'
import type { TranslateFn } from '../../i18n'
import { clock, type UiMessage } from './messageFormat'

export function MessageBubble({
  m,
  mine,
  canDelete,
  onDelete,
  onRestore,
  onRetry,
  onDiscard,
  t,
}: {
  m: UiMessage
  mine: boolean
  canDelete: boolean
  onDelete: () => void
  onRestore: () => void
  onRetry: () => void
  onDiscard: () => void
  t: TranslateFn
}) {
  const [, force] = useState(0)
  const restorableUntil = m.restorable_until ? new Date(m.restorable_until).getTime() : 0
  const canRestore = Boolean(m.deleted && restorableUntil > Date.now())

  // Re-render once the undo window closes so the button disappears on time.
  useEffect(() => {
    if (!canRestore) return
    const id = window.setTimeout(() => force((n) => n + 1), Math.max(0, restorableUntil - Date.now()) + 50)
    return () => window.clearTimeout(id)
  }, [canRestore, restorableUntil])

  if (m.deleted) {
    return (
      <div
        className={`flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-3 py-1.5 text-xs italic text-slate-500 ${
          mine ? 'rounded-br-md' : 'rounded-bl-md'
        }`}
      >
        <Trash2 className="h-3 w-3" aria-hidden />
        <span>{t('messages.deletedPlaceholder')}</span>
        {canRestore && (
          <button type="button" onClick={onRestore} className="inline-flex items-center gap-1 font-semibold not-italic text-teal-700 hover:underline">
            <RotateCcw className="h-3 w-3" /> {t('messages.undo')}
          </button>
        )}
      </div>
    )
  }

  const failed = m.localState === 'failed'
  return (
    <div className={`group flex items-center gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
      <div
        className={`relative rounded-2xl px-3.5 py-2 text-[14px] leading-snug shadow-sm ${
          mine
            ? failed
              ? 'rounded-br-md bg-rose-50 text-rose-900 ring-1 ring-rose-200'
              : 'rounded-br-md bg-teal-600 text-white'
            : 'rounded-bl-md bg-white text-navy-900 ring-1 ring-slate-200'
        } ${m.localState === 'sending' ? 'opacity-70' : ''}`}
      >
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine && !failed ? 'text-teal-100' : 'text-slate-400'}`}>
          <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('tr-TR')}>
            {clock(m.created_at)}
          </time>
          {mine &&
            (m.localState === 'sending' ? (
              <Clock className="h-3 w-3" aria-label={t('messages.statusSending')} />
            ) : failed ? (
              <AlertCircle className="h-3 w-3 text-rose-600" aria-label={t('messages.statusFailed')} />
            ) : m.read_by_other ? (
              <CheckCheck className="h-3.5 w-3.5 text-white" aria-label={t('messages.statusRead')} />
            ) : (
              <Check className="h-3.5 w-3.5" aria-label={t('messages.statusSent')} />
            ))}
        </span>
        {failed && (
          <span className="mt-1 flex gap-3 text-[11px] font-semibold">
            <button type="button" onClick={onRetry} className="text-rose-700 hover:underline">
              {t('messages.retrySend')}
            </button>
            <button type="button" onClick={onDiscard} className="text-slate-500 hover:underline">
              {t('common.cancel')}
            </button>
          </span>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 focus:text-rose-600 group-hover:text-slate-500"
          title={t('messages.deleteMessage')}
          aria-label={t('messages.deleteMessage')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
