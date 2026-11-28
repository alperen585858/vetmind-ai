import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
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
import {
  TYPING_PING_MS,
  TYPING_SHOW_MS,
  UNDO_TOAST_MS,
  canDeleteThread,
  channelLabel,
  filterThreads,
  groupMessages,
  type Filter,
  type UiMessage,
} from './messageFormat'
import { ChatHeader, MessageLog } from './ChatPane'
import { ComposeModal } from './ComposeModal'
import { ThreadList } from './ThreadList'
import type {
  BackendMessageRecipient,
  BackendSupportMessage,
  BackendSupportThreadDetail,
  BackendSupportThreadSummary,
} from '../../shared/types'

export default function Messages() {
  const { role, user, pushToast } = useApp()
  const { t } = useLocale()
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

  const filtered = useMemo(() => filterThreads(threads, filter, query), [threads, query, filter])

  const unreadTotal = threads.reduce((n, th) => n + th.unread_count, 0)
  const showChat = Boolean(threadId)
  const thread = detail?.thread
  const counterpartName = thread?.counterpart_name || (thread ? channelLabel(thread.channel, t) : '')
  const canDelete = (th: BackendSupportThreadSummary | undefined) => canDeleteThread(th, role, me)
  const canDeleteOpenThread = canDelete(thread)
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
          <ThreadList
            subtitle={subtitle}
            canCompose={canCompose}
            onCompose={openCompose}
            query={query}
            onQuery={setQuery}
            filters={filters}
            filter={filter}
            onFilter={setFilter}
            error={error}
            onRetry={() => void loadThreads()}
            loading={loading}
            threads={threads}
            filtered={filtered}
            activeThreadId={threadId}
            canDelete={canDelete}
            onDelete={setPendingDeleteThread}
            onOpen={(id) => navigate(`/mesajlar/${id}`)}
          />
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
              <ChatHeader
                thread={thread}
                counterpartName={counterpartName}
                typing={Boolean(typingName)}
                canDelete={canDeleteOpenThread}
                onBack={() => navigate('/mesajlar')}
                onDelete={() => setPendingDeleteThread(thread.thread_id)}
              />

              {liveStatus === 'retrying' && (
                <div className="flex items-center justify-center gap-1.5 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
                  <WifiOff className="h-3 w-3" /> {t('messages.reconnecting')}
                </div>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" role="log" aria-label={t('messages.historyLabel')}>
                <MessageLog
                  groups={groups}
                  me={me}
                  role={role}
                  channel={thread.channel}
                  counterpartName={counterpartName}
                  typingName={typingName}
                  onDelete={(m) => void deleteMessage(m)}
                  onRestore={(m) => void restoreMessage(thread.thread_id, m.message_id)}
                  onRetry={retry}
                  onDiscard={discardFailed}
                />
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

      <ComposeModal
        open={composeOpen && canCompose}
        onClose={() => setComposeOpen(false)}
        recipient={recipient}
        onRecipient={setRecipient}
        recipientQuery={recipientQuery}
        onRecipientQuery={setRecipientQuery}
        subject={subject}
        onSubject={setSubject}
        body={body}
        onBody={setBody}
        busy={composeBusy}
        onSend={() => void startConversation()}
      />
    </>
  )
}
