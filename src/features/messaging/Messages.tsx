import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Shield,
  Stethoscope,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import type { TranslateFn } from '../../i18n'
import { Button } from '../../shared/ui/Button'
import { Modal } from '../../shared/ui/Modal'
import { useLiveEvents, useLiveStatus } from '../../shared/live/liveStream'
import {
  createSupportThread,
  deleteSupportMessage,
  deleteSupportThread,
  getSupportThread,
  listMessageRecipients,
  listSupportThreads,
  markSupportThreadRead,
  postSupportMessage,
  restoreSupportMessage,
  sendTypingPing,
} from './api'
import { fmtDate } from '../../shared/lib/format'
import type {
  BackendMessageRecipient,
  BackendSupportMessage,
  BackendSupportThreadDetail,
  BackendSupportThreadSummary,
  SupportMessageChannel,
} from '../../shared/types'

// --- helpers ---------------------------------------------------------------------------

type Filter = 'all' | 'unread' | 'radiologist' | 'admin' | 'clinic'

/** A message as shown in the UI: server messages plus optimistic ones still sending. */
type UiMessage = BackendSupportMessage & { localState?: 'sending' | 'failed'; localId?: string }

/** Demo rows saved before messages were attributed to a person (auth-off only); the
 * backend allows deleting them only in auth-off demo mode. */
const LEGACY_DEMO_SUBJECTS = new Set(['anonymous', 'demo'])

const UNDO_TOAST_MS = 10_000
const TYPING_SHOW_MS = 4_000
const TYPING_PING_MS = 3_000

function channelLabel(channel: SupportMessageChannel, t: TranslateFn) {
  if (channel === 'admin') return t('messages.channelAdmin')
  if (channel === 'clinic') return t('messages.channelClinic')
  return t('messages.channelRadiologist')
}

function roleLabel(role: string, t: TranslateFn): string {
  const keys: Record<string, string> = {
    owner: 'messages.roleOwner', // legacy rows only
    support: 'messages.roleSupport',
    expert: 'messages.roleExpert',
    admin: 'messages.roleAdmin',
    vet: 'messages.roleVet',
    clinic_owner: 'messages.roleClinicOwner',
    demo: 'messages.roleDemo',
    service: 'messages.roleService',
  }
  return keys[role] ? t(keys[role]) : role
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase('tr')
}

function avatarTone(role: string | null | undefined) {
  if (role === 'support' || role === 'admin') return 'bg-sky-100 text-sky-800'
  if (role === 'expert') return 'bg-violet-100 text-violet-800'
  if (role === 'clinic_owner') return 'bg-amber-100 text-amber-800'
  return 'bg-teal-100 text-teal-800'
}

function clock(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function localDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayLabel(iso: string, locale: 'tr' | 'en', t: TranslateFn): string {
  const key = localDayKey(iso)
  const now = new Date()
  const today = localDayKey(now.toISOString())
  const yesterday = localDayKey(new Date(now.getTime() - 86_400_000).toISOString())
  if (key === today) return t('messages.today')
  if (key === yesterday) return t('messages.yesterday')
  return fmtDate(key, locale)
}

function listTime(iso: string | null | undefined, locale: 'tr' | 'en', t: TranslateFn): string {
  if (!iso) return ''
  if (localDayKey(iso) === localDayKey(new Date().toISOString())) return clock(iso)
  return dayLabel(iso, locale, t).replace(/\s\d{4}$/, '')
}

type Group = { day: string; runs: { author: string; role: string; items: UiMessage[] }[] }

/** Group by local day, then by consecutive author (name/avatar shown once per run). */
function groupMessages(messages: UiMessage[]): Group[] {
  const out: Group[] = []
  for (const m of messages) {
    const day = localDayKey(m.created_at)
    let g = out[out.length - 1]
    if (!g || g.day !== day) {
      g = { day, runs: [] }
      out.push(g)
    }
    const run = g.runs[g.runs.length - 1]
    if (run && run.author === m.author_subject) run.items.push(m)
    else g.runs.push({ author: m.author_subject, role: m.author_role, items: [m] })
  }
  return out
}

// --- page ------------------------------------------------------------------------------

export default function Messages() {
  const { role, user, pushToast } = useApp()
  const { t, locale } = useLocale()
  const navigate = useLocalizedNavigate()
  const { threadId } = useParams<{ threadId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const liveStatus = useLiveStatus()
  const canCompose = role === 'vet' || role === 'clinic_owner'
  const me = (user?.email || '').toLowerCase()

  const [threads, setThreads] = useState<BackendSupportThreadSummary[]>([])
  const [detail, setDetail] = useState<BackendSupportThreadDetail | null>(null)
  const [pending, setPending] = useState<UiMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [reply, setReply] = useState('')
  const [typingName, setTypingName] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ threadId: string; messageId: string } | null>(null)
  // Thread id waiting for the "delete conversation" confirmation (header or list row).
  const [pendingDeleteThread, setPendingDeleteThread] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [recipient, setRecipient] = useState<BackendMessageRecipient | null>(null)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipients, setRecipients] = useState<BackendMessageRecipient[]>([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [composeBusy, setComposeBusy] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const typingTimer = useRef<number | undefined>(undefined)
  const lastTypingPing = useRef(0)
  const undoTimer = useRef<number | undefined>(undefined)
  const listTimer = useRef<number | undefined>(undefined)

  // --- data loading --------------------------------------------------------------------

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await listSupportThreads())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('messages.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  /** Coalesce bursts of live events into one list refresh. */
  const refreshThreadsSoon = useCallback(() => {
    window.clearTimeout(listTimer.current)
    listTimer.current = window.setTimeout(() => void loadThreads(), 250)
  }, [loadThreads])

  const loadDetail = useCallback(
    async (id: string, { markRead = true }: { markRead?: boolean } = {}) => {
      const d = await getSupportThread(id)
      if (threadIdRef.current !== id) return
      setDetail(d)
      if (markRead && d.messages.some((m) => m.unread) && document.visibilityState === 'visible') {
        const marked = await markSupportThreadRead(id)
        if (threadIdRef.current === id) setDetail(marked)
        refreshThreadsSoon()
      }
    },
    [refreshThreadsSoon],
  )

  useEffect(() => {
    void loadThreads()
  }, [loadThreads, role])

  useEffect(() => {
    setPending([])
    setTypingName(null)
    if (!threadId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    loadDetail(threadId)
      .catch((e) => {
        if (cancelled) return
        pushToast({ tone: 'error', title: t('messages.threadOpenFailed'), body: e instanceof Error ? e.message : undefined })
        setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [threadId, loadDetail, pushToast, t])

  // --- live events -----------------------------------------------------------------------

  useLiveEvents((e) => {
    const open = threadIdRef.current
    if (e.type === 'ready' || e.type === 'resync') {
      refreshThreadsSoon()
      if (open) void loadDetail(open).catch(() => undefined)
      return
    }
    if (!e.thread_id) return
    refreshThreadsSoon()
    if (e.thread_id !== open) return
    if (e.type === 'thread.deleted') {
      setDetail(null)
      navigate('/mesajlar')
      return
    }
    if (e.type === 'message.created') {
      const msg = e.message as BackendSupportMessage | undefined
      if (!msg) return
      setTypingName(null)
      setDetail((prev) =>
        prev && !prev.messages.some((m) => m.message_id === msg.message_id)
          ? { ...prev, messages: [...prev.messages, { ...msg, unread: msg.author_subject !== me }] }
          : prev,
      )
      if (msg.author_subject !== me && document.visibilityState === 'visible') {
        void markSupportThreadRead(open)
          .then((d) => {
            if (threadIdRef.current === open) setDetail(d)
          })
          .catch(() => undefined)
      }
      return
    }
    if (e.type === 'thread.read') {
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) => (m.author_subject === me ? { ...m, read_by_other: true } : m)),
            }
          : prev,
      )
      return
    }
    if (e.type === 'message.deleted' || e.type === 'message.restored') {
      void loadDetail(open, { markRead: false }).catch(() => undefined)
      return
    }
    if (e.type === 'typing' && e.subject !== me) {
      setTypingName(String(e.name || ''))
      window.clearTimeout(typingTimer.current)
      typingTimer.current = window.setTimeout(() => setTypingName(null), TYPING_SHOW_MS)
    }
  })

  // --- scrolling -------------------------------------------------------------------------

  const messages: UiMessage[] = useMemo(
    () => [...(detail?.messages ?? []), ...pending.filter((p) => p.localState)],
    [detail?.messages, pending],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, threadId, typingName])

  // --- compose (new conversation) --------------------------------------------------------

  useEffect(() => {
    if (!composeOpen || !canCompose) return
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
  }, [composeOpen, canCompose, recipientQuery])

  // /mesajlar?yeni=<e-mail> (clinic team page) → new conversation with that colleague preselected.
  useEffect(() => {
    const to = searchParams.get('yeni')?.trim().toLowerCase()
    if (!to || !canCompose) return
    const next = new URLSearchParams(searchParams)
    next.delete('yeni')
    setSearchParams(next, { replace: true })
    // Not cancelled on cleanup: removing the param above re-runs this effect.
    listMessageRecipients(to)
      .then((items) => {
        const match = items.find((r) => r.subject.toLowerCase() === to)
        setRecipient(match ?? null)
        setRecipientQuery(match ? '' : to)
      })
      .catch(() => setRecipientQuery(to))
      .finally(() => setComposeOpen(true))
  }, [searchParams, setSearchParams, canCompose])

  // /mesajlar?new=support → new conversation with the support team preselected.
  useEffect(() => {
    if (searchParams.get('new') !== 'support' || !canCompose) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    setRecipient({ subject: 'support', display_name: t('messages.channelAdmin'), role: 'support', channel: 'admin' })
    setSubject((prev) => prev || t('messages.supportPrefillSubject'))
    setComposeOpen(true)
  }, [searchParams, setSearchParams, canCompose, t])

  const openCompose = () => {
    setRecipient(null)
    setRecipientQuery('')
    setSubject('')
    setBody('')
    setComposeOpen(true)
  }

  const startConversation = async () => {
    if (!recipient) {
      pushToast({ tone: 'warning', title: t('messages.recipientRequired') })
      return
    }
    if (!subject.trim() || !body.trim()) return
    setComposeBusy(true)
    try {
      const created = await createSupportThread({
        channel: recipient.channel,
        recipient_subject: recipient.channel === 'admin' ? undefined : recipient.subject,
        subject: subject.trim(),
        body: body.trim(),
      })
      setComposeOpen(false)
      setRecipient(null)
      setSubject('')
      setBody('')
      await loadThreads()
      navigate(`/mesajlar/${created.thread.thread_id}`)
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('messages.sendFailed'),
        body: e instanceof Error ? `${e.message} ${t('messages.sendFailedKeep')}` : t('messages.sendFailedKeep'),
      })
    } finally {
      setComposeBusy(false)
    }
  }

  // --- send / retry ----------------------------------------------------------------------

  const sendText = async (text: string, localId: string) => {
    const id = threadIdRef.current
    if (!id) return
    try {
      const msg = await postSupportMessage(id, text)
      setPending((prev) => prev.filter((p) => p.localId !== localId))
      if (threadIdRef.current !== id) return
      setDetail((prev) =>
        prev && !prev.messages.some((m) => m.message_id === msg.message_id)
          ? { ...prev, messages: [...prev.messages, msg] }
          : prev,
      )
      refreshThreadsSoon()
    } catch {
      setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, localState: 'failed' } : p)))
    }
  }

  const sendReply = () => {
    const text = reply.trim()
    if (!threadId || !text) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setPending((prev) => [
      ...prev,
      {
        message_id: localId,
        localId,
        localState: 'sending',
        author_subject: me,
        author_role: role || 'vet',
        body: text,
        created_at: new Date().toISOString(),
        unread: false,
      },
    ])
    setReply('')
    requestAnimationFrame(() => textareaRef.current?.focus())
    void sendText(text, localId)
  }

  const retry = (m: UiMessage) => {
    if (!m.localId) return
    setPending((prev) => prev.map((p) => (p.localId === m.localId ? { ...p, localState: 'sending' } : p)))
    void sendText(m.body, m.localId)
  }

  const discardFailed = (m: UiMessage) => setPending((prev) => prev.filter((p) => p.localId !== m.localId))

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendReply()
    }
  }

  const onReplyChange = (value: string) => {
    setReply(value)
    const now = Date.now()
    if (threadId && value.trim() && now - lastTypingPing.current > TYPING_PING_MS) {
      lastTypingPing.current = now
      void sendTypingPing(threadId).catch(() => undefined)
    }
  }

  // Auto-grow the composer up to ~6 lines.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [reply])

  // --- delete / undo ---------------------------------------------------------------------

  const deleteMessage = async (m: UiMessage) => {
    if (!threadId) return
    try {
      setDetail(await deleteSupportMessage(threadId, m.message_id))
      refreshThreadsSoon()
      window.clearTimeout(undoTimer.current)
      setUndo({ threadId, messageId: m.message_id })
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_TOAST_MS)
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.deleteMessageFailed'), body: e instanceof Error ? e.message : undefined })
    }
  }

  const restoreMessage = async (threadKey: string, messageId: string) => {
    try {
      const d = await restoreSupportMessage(threadKey, messageId)
      if (threadIdRef.current === threadKey) setDetail(d)
      setUndo(null)
      refreshThreadsSoon()
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.undoFailed'), body: e instanceof Error ? e.message : undefined })
    }
  }

  const confirmDeleteThread = async () => {
    const target = pendingDeleteThread
    if (!target || deleting) return
    setDeleting(true)
    try {
      await deleteSupportThread(target)
      setPendingDeleteThread(null)
      setThreads((prev) => prev.filter((th) => th.thread_id !== target))
      if (threadIdRef.current === target) {
        setDetail(null)
        navigate('/mesajlar')
      }
      void loadThreads()
      pushToast({ tone: 'success', title: t('messages.threadDeleted') })
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.deleteThreadFailed'), body: e instanceof Error ? e.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  // --- derived ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return [...threads]
      .sort((a, b) => (b.last_message_at || b.updated_at || '').localeCompare(a.last_message_at || a.updated_at || ''))
      .filter((th) => {
        if (filter === 'unread' && th.unread_count === 0) return false
        if (filter === 'radiologist' && th.channel !== 'radiologist') return false
        if (filter === 'admin' && th.channel !== 'admin') return false
        if (filter === 'clinic' && th.channel !== 'clinic') return false
        if (!q) return true
        return [th.subject, th.last_message_preview, th.counterpart_name, th.owner_subject]
          .filter(Boolean)
          .some((f) => String(f).toLocaleLowerCase('tr').includes(q))
      })
  }, [threads, query, filter])

  const unreadTotal = threads.reduce((n, th) => n + th.unread_count, 0)
  const showChat = Boolean(threadId)
  const thread = detail?.thread
  const counterpartName = thread?.counterpart_name || (thread ? channelLabel(thread.channel, t) : '')
  /** Participants (and admins) may delete a whole conversation. */
  const canDelete = (th: BackendSupportThreadSummary | undefined) =>
    Boolean(
      th &&
        (role === 'admin' ||
          th.owner_subject === me ||
          th.recipient_subject === me ||
          LEGACY_DEMO_SUBJECTS.has(th.owner_subject)),
    )
  const canDeleteThread = canDelete(thread)
  const subtitle =
    role === 'expert' ? t('messages.subtitleExpert') : role === 'admin' ? t('messages.subtitleAdmin') : t('messages.subtitleStaff')
  const groups = useMemo(() => groupMessages(messages), [messages])

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('messages.filterAll') },
    { id: 'unread', label: unreadTotal ? `${t('messages.filterUnread')} · ${unreadTotal}` : t('messages.filterUnread') },
    { id: 'radiologist', label: t('messages.channelRadiologist') },
    { id: 'admin', label: t('messages.channelAdmin') },
    ...(canCompose ? [{ id: 'clinic' as const, label: t('messages.channelClinic') }] : []),
  ]

  // --- render ----------------------------------------------------------------------------

  return (
    <>
      <div className="flex h-[calc(100dvh-7rem)] min-h-[480px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Conversation list */}
        <aside
          className={`min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-white lg:flex lg:w-[340px] ${
            showChat ? 'hidden' : 'flex'
          }`}
          aria-label={t('messages.conversations')}
        >
          <div className="space-y-3 border-b border-slate-100 px-4 pb-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="font-display text-xl font-bold tracking-tight text-navy-950">{t('messages.title')}</h1>
                <p className="truncate text-xs text-slate-500">{subtitle}</p>
              </div>
              {canCompose && (
                <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={openCompose} icon={<Plus className="h-4 w-4" />}>
                  {t('messages.newMessage')}
                </Button>
              )}
            </div>
            <label className="relative block">
              <span className="sr-only">{t('messages.searchPlaceholder')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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
                  onClick={() => setFilter(f.id)}
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
              <button type="button" className="shrink-0 font-semibold underline" onClick={() => void loadThreads()}>
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
                  <Button size="sm" className="mt-4" onClick={openCompose} icon={<Plus className="h-4 w-4" />}>
                    {t('messages.newMessage')}
                  </Button>
                )}
              </div>
            ) : (
              <ul className="p-2">
                {filtered.map((th) => {
                  const active = threadId === th.thread_id
                  const name = th.counterpart_name || channelLabel(th.channel, t)
                  const unread = th.unread_count > 0
                  return (
                    <li key={th.thread_id} className="group/row relative">
                      {canDelete(th) && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteThread(th.thread_id)}
                          className="absolute bottom-2 right-2 z-10 rounded-lg bg-white p-1.5 text-slate-400 opacity-0 shadow-sm ring-1 ring-slate-200 transition hover:text-rose-600 focus:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-80"
                          title={t('messages.deleteThread')}
                          aria-label={`${t('messages.deleteThread')}: ${th.counterpart_name || th.subject}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/mesajlar/${th.thread_id}`)}
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
        </aside>

        {/* Chat */}
        <section className={`min-h-0 min-w-0 flex-1 flex-col bg-slate-50 lg:flex ${showChat ? 'flex' : 'hidden'}`}>
          {!threadId ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-teal-700 shadow-sm ring-1 ring-slate-200">
                <MessageSquare className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-navy-900">{t('messages.brandTitle')}</h2>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                {t('messages.selectThread')}
                {canCompose ? t('messages.selectThreadOrNew') : ''}.
              </p>
              {canCompose && (
                <Button className="mt-5" onClick={openCompose} icon={<Plus className="h-4 w-4" />}>
                  {t('messages.newMessage')}
                </Button>
              )}
            </div>
          ) : detailLoading && !detail ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('messages.loadingThread')}
            </div>
          ) : !detail || !thread ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">{t('messages.threadOpenFailed')}</div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-navy-800 hover:bg-slate-100 lg:hidden"
                  onClick={() => navigate('/mesajlar')}
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
                    {typingName ? (
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
                {canDeleteThread && (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteThread(thread.thread_id)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-50"
                    title={t('messages.deleteThread')}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">{t('messages.deleteThread')}</span>
                    <span className="sr-only sm:hidden">{t('messages.deleteThread')}</span>
                  </button>
                )}
              </header>

              {liveStatus === 'retrying' && (
                <div className="flex items-center justify-center gap-1.5 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
                  <WifiOff className="h-3 w-3" /> {t('messages.reconnecting')}
                </div>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" role="log" aria-label={t('messages.historyLabel')}>
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
                        const name = run.role === 'admin' && thread.channel === 'admin' ? t('messages.roleSupport') : counterpartName
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
                                  onDelete={() => void deleteMessage(m)}
                                  onRestore={() => void restoreMessage(thread.thread_id, m.message_id)}
                                  onRetry={() => retry(m)}
                                  onDiscard={() => discardFailed(m)}
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
              </div>

              {undo && undo.threadId === thread.thread_id && (
                <div className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-md items-center gap-3 rounded-xl bg-navy-950 px-4 py-2.5 text-sm text-white shadow-lg" role="status">
                  <span className="flex-1">{t('messages.messageDeleted')}</span>
                  <button
                    type="button"
                    onClick={() => void restoreMessage(undo.threadId, undo.messageId)}
                    className="inline-flex items-center gap-1 font-semibold text-teal-300 hover:text-teal-200"
                  >
                    <RotateCcw className="h-4 w-4" /> {t('messages.undo')}
                  </button>
                </div>
              )}

              <form
                className="border-t border-slate-200 bg-white px-3 py-3 sm:px-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendReply()
                }}
              >
                <div className="mx-auto flex max-w-3xl items-end gap-2">
                  <label className="sr-only" htmlFor="message-composer">
                    {t('messages.messageLabel')}
                  </label>
                  <textarea
                    id="message-composer"
                    ref={textareaRef}
                    rows={1}
                    value={reply}
                    onChange={(e) => onReplyChange(e.target.value)}
                    onKeyDown={onComposerKey}
                    placeholder={t('messages.placeholder')}
                    maxLength={4000}
                    className="max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-navy-900 outline-none placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
                  />
                  <button
                    type="submit"
                    disabled={!reply.trim()}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    aria-label={t('messages.send')}
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
                <p className="mx-auto mt-1 max-w-3xl px-1 text-[11px] text-slate-400">{t('messages.composerHint')}</p>
              </form>
            </>
          )}
        </section>
      </div>

      <Modal
        open={Boolean(pendingDeleteThread)}
        onClose={() => {
          if (!deleting) setPendingDeleteThread(null)
        }}
        title={t('messages.deleteThreadTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingDeleteThread(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => void confirmDeleteThread()}
            >
              {deleting ? t('messages.deleting') : t('messages.confirmDelete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('messages.deleteThreadConfirm')}</p>
      </Modal>

      <Modal open={composeOpen && canCompose} onClose={() => setComposeOpen(false)} title={t('messages.newThread')}>
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
                <button type="button" className="text-xs font-semibold text-teal-800 hover:underline" onClick={() => setRecipient(null)}>
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
                    onChange={(e) => setRecipientQuery(e.target.value)}
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
                            onClick={() => setRecipient(r)}
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
            <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('messages.subjectPlaceholder')} maxLength={200} />
          </label>
          <label className="block">
            <span className="label">{t('messages.messageLabel')}</span>
            <textarea
              className="input mt-1 min-h-[110px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('messages.bodyPlaceholder')}
              maxLength={4000}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={composeBusy || !recipient || !subject.trim() || !body.trim()}
              onClick={() => void startConversation()}
              icon={composeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            >
              {composeBusy ? t('messages.sending') : t('messages.send')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// --- bubble ------------------------------------------------------------------------------

function MessageBubble({
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
