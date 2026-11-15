import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  ArrowLeft,
  CheckCheck,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Shield,
  Stethoscope,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import type { TranslateFn } from '../i18n'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import {
  createSupportThread,
  deleteSupportMessage,
  deleteSupportThread,
  getSupportThread,
  listSupportThreads,
  markSupportThreadRead,
  postSupportMessage,
} from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { BackendSupportThreadDetail, BackendSupportThreadSummary, SupportMessageChannel } from '../types'

function channelLabel(channel: SupportMessageChannel, t: TranslateFn) {
  return channel === 'admin' ? t('messages.channelAdmin') : t('messages.channelRadiologist')
}

function authorLabel(role: string, subject: string, t: TranslateFn): string {
  const roleKeys: Record<string, string> = {
    owner: 'messages.roleOwner',
    expert: 'messages.roleExpert',
    admin: 'messages.roleAdmin',
    vet: 'messages.roleVet',
    clinic_owner: 'messages.roleClinicOwner',
    demo: 'messages.roleDemo',
    service: 'messages.roleService',
  }
  const key = roleKeys[role]
  if (key) return t(key)
  if (subject.startsWith('admin@')) return t('messages.roleAdmin')
  if (subject.startsWith('expert')) return t('messages.roleExpert')
  if (subject.startsWith('owner@')) return t('messages.roleOwner')
  if (subject.startsWith('vet')) return t('messages.roleVet')
  return role || subject
}

function fmtClock(iso?: string | null): string {
  if (!iso) return ''
  const normalized = iso.includes('T') ? iso.replace('T', ' ').replace(/Z$/, '') : iso
  const time = normalized.split(' ')[1]
  return time ? time.slice(0, 5) : ''
}

function fmtListTime(iso: string | null | undefined, locale: 'tr' | 'en'): string {
  if (!iso) return ''
  const clock = fmtClock(iso)
  const full = fmtDate(iso, locale)
  // Prefer clock for same-day feel; fall back to short date fragment
  if (clock && full.includes('·')) return clock
  return clock || full
}

function channelTone(channel: SupportMessageChannel) {
  if (channel === 'admin') return 'bg-sky-500/90 text-white'
  return 'bg-teal-400 text-navy-950'
}

export default function Messages() {
  const { role, user, pushToast } = useApp()
  const { t, locale } = useLocale()
  const navigate = useLocalizedNavigate()
  const { threadId } = useParams<{ threadId?: string }>()
  const isOwner = role === 'owner'
  const canCompose = isOwner
  const endRef = useRef<HTMLDivElement>(null)

  const [threads, setThreads] = useState<BackendSupportThreadSummary[]>([])
  const [detail, setDetail] = useState<BackendSupportThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [channel, setChannel] = useState<SupportMessageChannel>('radiologist')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null)
  const [pendingDeleteThread, setPendingDeleteThread] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadThreads = async () => {
    setLoading(true)
    setError(null)
    try {
      setThreads(await listSupportThreads())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('messages.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const loadDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const d = await getSupportThread(id)
      setDetail(d)
      if (d.messages.some((m) => m.unread)) {
        const marked = await markSupportThreadRead(id)
        setDetail(marked)
      }
      void loadThreads()
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.threadOpenFailed'), body: e instanceof Error ? e.message : undefined })
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    void loadThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  useEffect(() => {
    if (threadId) void loadDetail(threadId)
    else setDetail(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [detail?.messages.length, threadId])

  const sorted = useMemo(
    () => [...threads].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [threads],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (thread) =>
        thread.subject.toLowerCase().includes(q) ||
        (thread.last_message_preview || '').toLowerCase().includes(q) ||
        channelLabel(thread.channel, t).toLowerCase().includes(q) ||
        thread.owner_subject.toLowerCase().includes(q),
    )
  }, [sorted, query, t])

  const startConversation = async () => {
    if (!subject.trim() || !body.trim()) return
    setBusy(true)
    try {
      const created = await createSupportThread({
        channel,
        subject: subject.trim(),
        body: body.trim(),
      })
      pushToast({ tone: 'success', title: t('messages.sent'), body: channelLabel(channel, t) })
      setComposeOpen(false)
      setSubject('')
      setBody('')
      await loadThreads()
      navigate(`/mesajlar/${created.thread.thread_id}`)
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.sendFailed'), body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const sendReply = async () => {
    if (!threadId || !reply.trim()) return
    setBusy(true)
    try {
      const msg = await postSupportMessage(threadId, reply.trim())
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, msg],
              thread: {
                ...prev.thread,
                message_count: prev.thread.message_count + 1,
                last_message_preview: msg.body,
                last_message_at: msg.created_at,
                updated_at: msg.created_at,
              },
            }
          : prev,
      )
      setReply('')
      void loadThreads()
    } catch (e) {
      pushToast({ tone: 'error', title: t('messages.replyFailed'), body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const me = user?.email || ''
  const showChat = Boolean(threadId)
  const canDeleteThread = Boolean(detail && (isOwner || role === 'admin' || role === 'expert'))
  const subtitle = isOwner
    ? t('messages.subtitleOwner')
    : role === 'expert'
      ? t('messages.subtitleExpert')
      : t('messages.subtitleStaff')

  const confirmDeleteMessage = async () => {
    if (!threadId || !pendingDeleteMessageId || deleting) return
    setDeleting(true)
    try {
      const remaining = await deleteSupportMessage(threadId, pendingDeleteMessageId)
      setPendingDeleteMessageId(null)
      if (!remaining) {
        setDetail(null)
        await loadThreads()
        navigate('/mesajlar')
        pushToast({ tone: 'success', title: t('messages.messageDeleted') })
        return
      }
      setDetail(remaining)
      void loadThreads()
      pushToast({ tone: 'success', title: t('messages.messageDeleted') })
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('messages.deleteMessageFailed'),
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  const confirmDeleteThread = async () => {
    if (!threadId || deleting) return
    setDeleting(true)
    try {
      await deleteSupportThread(threadId)
      setPendingDeleteThread(false)
      setDetail(null)
      await loadThreads()
      navigate('/mesajlar')
      pushToast({ tone: 'success', title: t('messages.threadDeleted') })
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('messages.deleteThreadFailed'),
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="vm-fade-up relative -mx-2 sm:-mx-1">
        <div className="grid h-[calc(100dvh-7.5rem)] max-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-[1.75rem] shadow-[0_20px_50px_-28px_rgba(11,23,40,0.45)] lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          {/* Dark conversation rail */}
          <aside
            className={`relative flex min-h-0 flex-col overflow-hidden bg-[color:var(--vm-midnight,#0b1728)] text-white ${
              showChat ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(45,212,191,0.22),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(14,165,233,0.12),transparent_40%)]"
            />
            <div className="relative border-b border-white/10 px-5 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300/90">
                    {t('messages.conversations')}
                  </p>
                  <h1 className="mt-1 font-[family-name:var(--vm-font-display)] text-2xl font-semibold tracking-tight">
                    {t('messages.title')}
                  </h1>
                  <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
                </div>
                {canCompose && (
                  <button
                    type="button"
                    onClick={() => setComposeOpen(true)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-400 text-navy-950 transition hover:bg-teal-300"
                    title={t('messages.newMessage')}
                    aria-label={t('messages.newMessage')}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </div>

              <label className="relative mt-4 block">
                <span className="sr-only">{t('messages.searchPlaceholder')}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('messages.searchPlaceholder')}
                  className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/15 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-400/50"
                />
              </label>
            </div>

            {error && (
              <p className="relative mx-4 mb-2 rounded-xl bg-amber-400/15 px-3 py-2 text-xs text-amber-100" role="alert">
                {error}
              </p>
            )}

            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
                </p>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <MessageSquare className="mx-auto h-8 w-8 text-slate-500" />
                  <p className="mt-3 text-sm font-medium text-white">{t('messages.noMessages')}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {isOwner ? t('messages.emptyListHintOwner') : t('messages.emptyListHintStaff')}
                  </p>
                  {canCompose && (
                    <button
                      type="button"
                      onClick={() => setComposeOpen(true)}
                      className="mt-4 text-sm font-semibold text-teal-300 hover:text-teal-200"
                    >
                      {t('messages.newMessage')}
                    </button>
                  )}
                </div>
              ) : (
                <ul className="space-y-0.5 px-2 pb-3">
                  {filtered.map((thread) => {
                    const active = threadId === thread.thread_id
                    return (
                      <li key={thread.thread_id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/mesajlar/${thread.thread_id}`)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                            active ? 'bg-white/15 ring-1 ring-teal-300/40' : 'hover:bg-white/8'
                          }`}
                        >
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${channelTone(thread.channel)}`}
                          >
                            {thread.channel === 'admin' ? <Shield className="h-5 w-5" /> : <Stethoscope className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-white">{thread.subject}</span>
                              <span
                                className={`shrink-0 text-[11px] ${
                                  thread.unread_count > 0 ? 'font-semibold text-teal-300' : 'text-slate-500'
                                }`}
                              >
                                {fmtListTime(thread.last_message_at || thread.updated_at, locale)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="truncate text-[12px] text-slate-400">
                                {!isOwner ? `${thread.owner_subject} · ` : ''}
                                {thread.last_message_preview || channelLabel(thread.channel, t)}
                              </p>
                              {thread.unread_count > 0 && (
                                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-teal-400 px-1.5 text-[11px] font-bold text-navy-950">
                                  {thread.unread_count}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Light chat stage */}
          <section
            className={`relative flex min-h-0 flex-col bg-[linear-gradient(180deg,#f0fdfa_0%,#f8fafc_40%,#ffffff_100%)] ${
              showChat ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {!threadId ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--vm-midnight,#0b1728)] text-teal-300 shadow-lg">
                  <MessageSquare className="h-7 w-7" />
                </div>
                <h2 className="mt-5 font-[family-name:var(--vm-font-display)] text-2xl font-semibold text-navy-900">
                  {t('messages.brandTitle')}
                </h2>
                <p className="mt-2 max-w-sm text-sm text-slate-500">
                  {t('messages.selectThread')}
                  {canCompose ? t('messages.selectThreadOrNew') : ''}.
                </p>
              </div>
            ) : detailLoading || !detail ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('messages.loadingThread')}
              </div>
            ) : (
              <>
                <header className="flex items-center gap-3 border-b border-slate-200/80 bg-white/80 px-3 py-3 backdrop-blur-sm sm:px-5">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-navy-800 transition hover:bg-slate-200 lg:hidden"
                    onClick={() => navigate('/mesajlar')}
                    aria-label={t('messages.backToThreads')}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${channelTone(detail.thread.channel)}`}
                  >
                    {detail.thread.channel === 'admin' ? (
                      <Shield className="h-5 w-5" />
                    ) : (
                      <Stethoscope className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-navy-900">{detail.thread.subject}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {channelLabel(detail.thread.channel, t)}
                      {!isOwner ? ` · ${detail.thread.owner_subject}` : ''}
                      {detail.thread.related_case_id ? (
                        <>
                          {' · '}
                          <LocalizedLink
                            className="font-medium text-teal-700 underline decoration-teal-300/60 underline-offset-2 hover:decoration-teal-700"
                            to={`/vakalar/${detail.thread.related_case_id}`}
                          >
                            {t('messages.goToCase')}
                          </LocalizedLink>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {canDeleteThread && (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteThread(true)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      title={t('messages.deleteThread')}
                      aria-label={t('messages.deleteThread')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </header>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6">
                  {detail.messages.map((m) => {
                    const mine = Boolean(me && m.author_subject === me)
                    const canDeleteMsg = mine || role === 'admin'
                    return (
                      <div key={m.message_id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`relative max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[70%] ${
                            mine
                              ? 'rounded-br-md bg-[color:var(--vm-midnight,#0b1728)] text-white'
                              : 'rounded-bl-md bg-white text-navy-900 ring-1 ring-slate-200/80'
                          }`}
                        >
                          {!mine && (
                            <p className="mb-0.5 text-[11px] font-semibold text-teal-700">
                              {authorLabel(m.author_role, m.author_subject, t)}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap text-[14px] leading-snug">{m.body}</p>
                          <div
                            className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                              mine ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {canDeleteMsg && (
                              <button
                                type="button"
                                onClick={() => setPendingDeleteMessageId(m.message_id)}
                                className={`rounded p-0.5 opacity-70 transition hover:opacity-100 ${
                                  mine ? 'hover:bg-white/10 hover:text-rose-300' : 'hover:bg-rose-50 hover:text-rose-600'
                                }`}
                                title={t('messages.deleteMessage')}
                                aria-label={t('messages.deleteMessage')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                            <span>{fmtClock(m.created_at) || fmtDate(m.created_at, locale)}</span>
                            {mine && <CheckCheck className="h-3.5 w-3.5 text-teal-300" aria-hidden />}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={endRef} />
                </div>

                <form
                  className="border-t border-slate-200/80 bg-white/90 px-3 py-3 backdrop-blur-sm sm:px-5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void sendReply()
                  }}
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 py-2 ring-1 ring-slate-200/80 focus-within:ring-2 focus-within:ring-teal-400/50">
                      <label className="sr-only" htmlFor="wa-reply">
                        {t('messages.messageLabel')}
                      </label>
                      <textarea
                        id="wa-reply"
                        rows={1}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void sendReply()
                          }
                        }}
                        placeholder={t('messages.placeholder')}
                        className="max-h-32 w-full resize-none border-0 bg-transparent py-1.5 text-sm text-navy-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy || !reply.trim()}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-400 text-navy-950 shadow-md transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={t('messages.send')}
                    >
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={Boolean(pendingDeleteMessageId)}
        onClose={() => {
          if (!deleting) setPendingDeleteMessageId(null)
        }}
        title={t('messages.deleteMessageTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingDeleteMessageId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => void confirmDeleteMessage()}
            >
              {deleting ? t('messages.deleting') : t('messages.confirmDelete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('messages.deleteMessageConfirm')}</p>
      </Modal>

      <Modal
        open={pendingDeleteThread}
        onClose={() => {
          if (!deleting) setPendingDeleteThread(false)
        }}
        title={t('messages.deleteThreadTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingDeleteThread(false)}>
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
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setChannel('radiologist')}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                  channel === 'radiologist' ? 'bg-teal-400 text-navy-950' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Stethoscope className="h-4 w-4" /> {t('messages.channelRadiologist')}
              </button>
              <button
                type="button"
                onClick={() => setChannel('admin')}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                  channel === 'admin' ? 'bg-[color:var(--vm-midnight,#0b1728)] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Shield className="h-4 w-4" /> {t('messages.channelAdmin')}
              </button>
            </div>
          </div>
          <label className="block">
            <span className="label">{t('messages.subject')}</span>
            <input
              className="input mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('messages.subjectPlaceholder')}
            />
          </label>
          <label className="block">
            <span className="label">{t('messages.messageLabel')}</span>
            <textarea
              className="input mt-1 min-h-[110px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('messages.bodyPlaceholder')}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={() => void startConversation()}
              icon={<Send className="h-4 w-4" />}
            >
              {busy ? t('messages.sending') : t('messages.send')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
