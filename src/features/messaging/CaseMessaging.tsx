import { useEffect, useState } from 'react'
import { Loader2, MessageSquare, Send } from 'lucide-react'
import { Card, CardHeader } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { useLocale } from '../../context/LocaleContext'
import { listCaseMessages, markCaseMessagesRead, postCaseMessage } from './api'
import { fmtDate } from '../../lib/format'
import type { BackendCaseMessage } from '../../types'

export function CaseMessaging({
  caseId,
  enabled,
}: {
  caseId: string
  enabled: boolean
}) {
  const { t, locale } = useLocale()
  const [messages, setMessages] = useState<BackendCaseMessage[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unread = messages.filter((m) => m.unread).length

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const rows = await listCaseMessages(caseId)
        if (cancelled) return
        setMessages(rows)
        if (rows.some((m) => m.unread)) {
          const marked = await markCaseMessagesRead(caseId)
          if (!cancelled) setMessages(marked)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('cases.messaging.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseId, enabled, t])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setError(null)
    setSending(true)
    try {
      const msg = await postCaseMessage(caseId, body)
      setMessages((prev) => [...prev, msg])
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cases.messaging.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  if (!enabled) {
    return (
      <Card>
        <CardHeader
          title={t('cases.messaging.title')}
          subtitle={t('cases.messaging.backendOnly')}
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <p className="px-5 pb-5 text-sm text-slate-500">{t('cases.messaging.localDemoUnavailable')}</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('cases.messaging.title')}
        subtitle={
          unread > 0
            ? t('cases.messaging.unread', { count: unread })
            : t('cases.messaging.subtitle')
        }
        icon={<MessageSquare className="h-5 w-5" />}
        action={
          unread > 0 ? (
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              {unread}
            </span>
          ) : undefined
        }
      />
      {loading ? (
        <p className="flex items-center gap-2 px-5 pb-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto px-5 pb-3">
          {messages.length === 0 ? (
            <li className="text-sm text-slate-500">{t('cases.messaging.empty')}</li>
          ) : (
            messages.map((m) => (
              <li
                key={m.message_id}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  m.unread ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50/80'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium text-navy-900">
                    {m.author_id} · {m.author_role}
                  </span>
                  <span>{fmtDate(m.created_at, locale)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-navy-900">{m.body}</p>
              </li>
            ))
          )}
        </ul>
      )}
      {error && <p className="px-5 pb-2 text-xs text-rose-700">{error}</p>}
      <div className="flex gap-2 border-t border-slate-100 px-5 py-3">
        <textarea
          className="min-h-[64px] flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          placeholder={t('cases.messaging.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          className="self-end"
          size="sm"
          disabled={sending || !text.trim()}
          icon={sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          onClick={() => void send()}
        >
          {t('common.send')}
        </Button>
      </div>
    </Card>
  )
}
