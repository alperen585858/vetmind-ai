import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import {
  createSupportThread,
  getSupportThread,
  listSupportThreads,
  markSupportThreadRead,
  postSupportMessage,
} from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { BackendSupportThreadDetail, BackendSupportThreadSummary, SupportMessageChannel } from '../types'

const CHANNEL_TR: Record<SupportMessageChannel, string> = {
  radiologist: 'Radyolog',
  admin: 'Yönetim / Admin',
}

const ROLE_TR: Record<string, string> = {
  owner: 'Hayvan sahibi',
  expert: 'Radyolog',
  admin: 'Admin',
  vet: 'Veteriner',
  clinic_owner: 'Klinik sahibi',
  demo: 'Demo',
  service: 'Servis',
}

function authorLabel(role: string, subject: string): string {
  const fromRole = ROLE_TR[role]
  if (fromRole) return fromRole
  if (subject.startsWith('admin@')) return 'Admin'
  if (subject.startsWith('expert')) return 'Radyolog'
  if (subject.startsWith('owner@')) return 'Hayvan sahibi'
  if (subject.startsWith('vet')) return 'Veteriner'
  return role || subject
}

function fmtClock(iso?: string | null): string {
  if (!iso) return ''
  const normalized = iso.includes('T') ? iso.replace('T', ' ').replace(/Z$/, '') : iso
  const time = normalized.split(' ')[1]
  return time ? time.slice(0, 5) : ''
}

function fmtListTime(iso?: string | null): string {
  if (!iso) return ''
  const clock = fmtClock(iso)
  const full = fmtDate(iso)
  // Prefer clock for same-day feel; fall back to short date fragment
  if (clock && full.includes('·')) return clock
  return clock || full
}

function channelTone(channel: SupportMessageChannel) {
  return channel === 'admin'
    ? 'bg-navy-800 text-sky-100'
    : 'bg-teal-600 text-white'
}

export default function Messages() {
  const { role, user, pushToast } = useApp()
  const navigate = useNavigate()
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

  const loadThreads = async () => {
    setLoading(true)
    setError(null)
    try {
      setThreads(await listSupportThreads())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mesajlar yüklenemedi')
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
      pushToast({ tone: 'error', title: 'Konuşma açılamadı', body: e instanceof Error ? e.message : undefined })
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
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        (t.last_message_preview || '').toLowerCase().includes(q) ||
        CHANNEL_TR[t.channel].toLowerCase().includes(q) ||
        t.owner_subject.toLowerCase().includes(q),
    )
  }, [sorted, query])

  const startConversation = async () => {
    if (!subject.trim() || !body.trim()) return
    setBusy(true)
    try {
      const created = await createSupportThread({
        channel,
        subject: subject.trim(),
        body: body.trim(),
      })
      pushToast({ tone: 'success', title: 'Mesaj gönderildi', body: CHANNEL_TR[channel] })
      setComposeOpen(false)
      setSubject('')
      setBody('')
      await loadThreads()
      navigate(`/mesajlar/${created.thread.thread_id}`)
    } catch (e) {
      pushToast({ tone: 'error', title: 'Gönderilemedi', body: e instanceof Error ? e.message : undefined })
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
      pushToast({ tone: 'error', title: 'Yanıt gönderilemedi', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const me = user?.email || ''
  const showChat = Boolean(threadId)

  return (
    <>
      <PageHeader
        title="İletişim"
        subtitle={
          isOwner
            ? 'Radyolog veya yönetim ile güvenli mesajlaşın'
            : role === 'expert'
              ? 'Hayvan sahiplerinden gelen radyolog mesajları'
              : 'Hayvan sahiplerinden gelen destek mesajları'
        }
        crumbs={[{ label: 'Ana sayfa', to: '/' }, { label: 'İletişim' }]}
      />

      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        <div className="grid h-[min(720px,calc(100vh-11.5rem))] min-h-[520px] lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Conversation list */}
          <aside
            className={`flex min-h-0 flex-col border-slate-200 bg-[#f0f2f5] lg:border-r ${
              showChat ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <div className="flex items-center gap-3 bg-[#008f7a] px-4 py-3 text-white">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
                {user?.initials || 'VM'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user?.name || 'VetMind'}</p>
                <p className="truncate text-[11px] text-teal-50/85">Konuşmalar</p>
              </div>
              {canCompose && (
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
                  title="Yeni mesaj"
                  aria-label="Yeni mesaj"
                >
                  <Plus className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="border-b border-slate-200/80 bg-[#f0f2f5] px-3 py-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ara veya yeni sohbet"
                  className="w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm text-navy-900 shadow-sm outline-none ring-1 ring-slate-200/80 placeholder:text-slate-400 focus:ring-teal-400"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              {loading ? (
                <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
                </p>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-navy-800">Henüz mesaj yok</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {isOwner ? 'Yeni bir konuşma başlatın.' : 'Size yöneltilmiş konuşma bulunmuyor.'}
                  </p>
                  {canCompose && (
                    <button
                      type="button"
                      onClick={() => setComposeOpen(true)}
                      className="mt-4 text-sm font-semibold text-teal-700 hover:underline"
                    >
                      Yeni mesaj
                    </button>
                  )}
                </div>
              ) : (
                <ul>
                  {filtered.map((t) => {
                    const active = threadId === t.thread_id
                    return (
                      <li key={t.thread_id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/mesajlar/${t.thread_id}`)}
                          className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left transition ${
                            active ? 'bg-[#e7f8f4]' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold ${channelTone(t.channel)}`}
                          >
                            {t.channel === 'admin' ? <Shield className="h-5 w-5" /> : <Stethoscope className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[15px] font-semibold text-navy-900">{t.subject}</span>
                              <span className={`shrink-0 text-[11px] ${t.unread_count > 0 ? 'font-semibold text-teal-600' : 'text-slate-400'}`}>
                                {fmtListTime(t.last_message_at || t.updated_at)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="truncate text-[13px] text-slate-500">
                                {!isOwner ? `${t.owner_subject} · ` : ''}
                                {t.last_message_preview || CHANNEL_TR[t.channel]}
                              </p>
                              {t.unread_count > 0 && (
                                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-teal-500 px-1.5 text-[11px] font-bold text-white">
                                  {t.unread_count}
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

          {/* Chat pane */}
          <section
            className={`flex min-h-0 flex-col bg-[#ece5dd] ${showChat ? 'flex' : 'hidden lg:flex'}`}
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35) 0 1px, transparent 1.5px), radial-gradient(circle at 80% 40%, rgba(0,0,0,0.03) 0 1px, transparent 1.5px)',
              backgroundSize: '28px 28px, 36px 36px',
            }}
          >
            {!threadId ? (
              <div className="flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] px-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                  <MessageSquare className="h-9 w-9 text-teal-600" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-navy-900">VetMind İletişim</h2>
                <p className="mt-2 max-w-sm text-sm text-slate-500">
                  Soldan bir konuşma seçin{canCompose ? ' veya yeni mesaj başlatın' : ''}.
                </p>
              </div>
            ) : detailLoading || !detail ? (
              <div className="flex flex-1 items-center justify-center gap-2 bg-[#f0f2f5] text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Konuşma yükleniyor…
              </div>
            ) : (
              <>
                <header className="flex items-center gap-3 border-b border-black/5 bg-[#008f7a] px-3 py-2.5 text-white shadow-sm sm:px-4">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 lg:hidden"
                    onClick={() => navigate('/mesajlar')}
                    aria-label="Konuşmalara dön"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      detail.thread.channel === 'admin' ? 'bg-navy-900 text-sky-100' : 'bg-teal-800 text-white'
                    }`}
                  >
                    {detail.thread.channel === 'admin' ? (
                      <Shield className="h-5 w-5" />
                    ) : (
                      <Stethoscope className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{detail.thread.subject}</p>
                    <p className="truncate text-[11px] text-teal-50/90">
                      {CHANNEL_TR[detail.thread.channel]}
                      {!isOwner ? ` · ${detail.thread.owner_subject}` : ''}
                      {detail.thread.related_case_id ? (
                        <>
                          {' · '}
                          <Link
                            className="font-medium underline decoration-white/40 underline-offset-2 hover:decoration-white"
                            to={`/vakalar/${detail.thread.related_case_id}`}
                          >
                            Vakaya git
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </header>

                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-6">
                  {detail.messages.map((m) => {
                    const mine = Boolean(me && m.author_subject === me)
                    return (
                      <div key={m.message_id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`relative max-w-[85%] rounded-lg px-3 py-1.5 shadow-sm sm:max-w-[70%] ${
                            mine
                              ? 'rounded-tr-none bg-[#d9fdd3] text-navy-900'
                              : 'rounded-tl-none bg-white text-navy-900'
                          }`}
                        >
                          {!mine && (
                            <p className="mb-0.5 text-[11px] font-semibold text-teal-700">
                              {authorLabel(m.author_role, m.author_subject)}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap text-[14.5px] leading-snug">{m.body}</p>
                          <div
                            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                              mine ? 'text-teal-800/70' : 'text-slate-400'
                            }`}
                          >
                            <span>{fmtClock(m.created_at) || fmtDate(m.created_at)}</span>
                            {mine && <CheckCheck className="h-3.5 w-3.5 text-sky-600" aria-hidden />}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={endRef} />
                </div>

                <form
                  className="flex items-end gap-2 bg-[#f0f2f5] px-3 py-2.5 sm:px-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void sendReply()
                  }}
                >
                  <div className="min-w-0 flex-1 rounded-3xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200/70 focus-within:ring-teal-400">
                    <label className="sr-only" htmlFor="wa-reply">
                      Mesaj
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
                      placeholder="Mesaj yazın"
                      className="max-h-32 w-full resize-none border-0 bg-transparent py-1.5 text-sm text-navy-900 outline-none placeholder:text-slate-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !reply.trim()}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#008f7a] text-white shadow-md transition hover:bg-[#007a69] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Gönder"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      <Modal open={composeOpen && canCompose} onClose={() => setComposeOpen(false)} title="Yeni konuşma">
        <div className="space-y-4">
          <div>
            <p className="label">Kime</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setChannel('radiologist')}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                  channel === 'radiologist'
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Stethoscope className="h-4 w-4" /> Radyolog
              </button>
              <button
                type="button"
                onClick={() => setChannel('admin')}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                  channel === 'admin' ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Shield className="h-4 w-4" /> Yönetim / Admin
              </button>
            </div>
          </div>
          <label className="block">
            <span className="label">Konu</span>
            <input
              className="input mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Örn. Rapor hakkında soru"
            />
          </label>
          <label className="block">
            <span className="label">Mesaj</span>
            <textarea
              className="input mt-1 min-h-[110px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Mesajınızı yazın…"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={() => void startConversation()}
              icon={<Send className="h-4 w-4" />}
            >
              {busy ? 'Gönderiliyor…' : 'Gönder'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
