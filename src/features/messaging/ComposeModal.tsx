import { useEffect, useState } from 'react'
import { Loader2, Search, Send, Shield, Stethoscope } from 'lucide-react'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { Modal } from '../../shared/ui/Modal'
import type { BackendMessageRecipient } from '../../shared/types'
import { listMessageRecipients } from './api'
import { avatarTone, initials, roleLabel } from './messageFormat'

/** "New conversation": recipient search / pick, subject and first message. */
export function ComposeModal({
  open,
  onClose,
  recipient,
  onRecipient,
  recipientQuery,
  onRecipientQuery,
  subject,
  onSubject,
  body,
  onBody,
  busy,
  onSend,
}: {
  open: boolean
  onClose: () => void
  recipient: BackendMessageRecipient | null
  onRecipient: (r: BackendMessageRecipient | null) => void
  recipientQuery: string
  onRecipientQuery: (q: string) => void
  subject: string
  onSubject: (v: string) => void
  body: string
  onBody: (v: string) => void
  busy: boolean
  onSend: () => void
}) {
  const { t } = useLocale()
  const [recipients, setRecipients] = useState<BackendMessageRecipient[]>([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setRecipientsLoading(true)
      setRecipientsError(false)
      listMessageRecipients(recipientQuery)
        .then((items) => {
          if (!cancelled) setRecipients(items)
        })
        .catch(() => {
          if (!cancelled) {
            setRecipients([])
            setRecipientsError(true)
          }
        })
        .finally(() => {
          if (!cancelled) setRecipientsLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, recipientQuery])

  return (
  <Modal open={open} onClose={onClose} title={t('messages.newThread')}>
    <div className="space-y-4">
      <div>
        <p className="label">{t('messages.composeTo')}</p>
        {recipient ? (
          <div className="mt-1.5 flex items-center gap-3 rounded-xl bg-teal-50 px-3 py-2 ring-1 ring-inset ring-teal-200">
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${avatarTone(recipient.role)}`}>
              {recipient.channel === 'admin' ? (
                <Shield className="h-4 w-4" />
              ) : recipient.channel === 'clinic' ? (
                initials(recipient.display_name)
              ) : (
                <Stethoscope className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-navy-900">{recipient.display_name}</span>
              <span className="block text-xs text-slate-500">{roleLabel(recipient.role, t)}</span>
            </span>
            <button type="button" className="text-xs font-semibold text-teal-800 hover:underline" onClick={() => onRecipient(null)}>
              {t('messages.changeRecipient')}
            </button>
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            <label className="relative block">
              <span className="sr-only">{t('messages.recipientSearch')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                className="input pl-9"
                value={recipientQuery}
                onChange={(e) => onRecipientQuery(e.target.value)}
                placeholder={t('messages.recipientSearchPlaceholder')}
                aria-label={t('messages.recipientSearch')}
                autoFocus
              />
            </label>
            <div className="max-h-56 overflow-y-auto rounded-xl ring-1 ring-slate-200" role="listbox" aria-label={t('messages.composeTo')}>
              {recipientsLoading ? (
                <p className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('messages.recipientsLoading')}
                </p>
              ) : recipientsError ? (
                <p className="px-3 py-3 text-sm text-rose-700" role="alert">
                  {t('messages.recipientsFailed')}
                </p>
              ) : recipients.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">{t('messages.recipientsEmpty')}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recipients.map((r) => (
                    <li key={r.subject}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onRecipient(r)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50"
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarTone(r.role)}`}>
                          {r.channel === 'admin' ? <Shield className="h-4 w-4" /> : initials(r.display_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-navy-900">{r.display_name}</span>
                          <span className="block text-xs text-slate-500">{roleLabel(r.role, t)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
      <label className="block">
        <span className="label">{t('messages.subject')}</span>
        <input className="input mt-1" value={subject} onChange={(e) => onSubject(e.target.value)} placeholder={t('messages.subjectPlaceholder')} maxLength={200} />
      </label>
      <label className="block">
        <span className="label">{t('messages.messageLabel')}</span>
        <textarea
          className="input mt-1 min-h-[110px]"
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder={t('messages.bodyPlaceholder')}
          maxLength={4000}
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={busy || !recipient || !subject.trim() || !body.trim()}
          onClick={onSend}
          icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        >
          {busy ? t('messages.sending') : t('messages.send')}
        </Button>
      </div>
    </div>
  </Modal>
  )
}
