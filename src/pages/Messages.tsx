import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, MessageSquare, Plus, Send, Shield, Stethoscope } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
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

export default function Messages() {
  const { role, user, pushToast } = useApp()
  const navigate = useNavigate()
  const { threadId } = useParams<{ threadId?: string }>()
  const isOwner = role === 'owner'
  const canCompose = isOwner

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

  const sorted = useMemo(
    () => [...threads].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [threads],
  )

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
        actions={
          canCompose ? (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setComposeOpen((v) => !v)}>
              Yeni mesaj
            </Button>
          ) : undefined
        }
      />

      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      )}

      {composeOpen && canCompose && (
        <Card className="mb-5 p-5">
          <CardHeader title="Yeni konuşma" subtitle="Kanal seçin ve mesajınızı yazın" icon={<MessageSquare className="h-5 w-5" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label sm:col-span-2">
              Kime
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setChannel('radiologist')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${
                    channel === 'radiologist'
                      ? 'bg-teal-50 text-teal-900 ring-teal-300'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Stethoscope className="h-4 w-4" /> Radyolog
                </button>
                <button
                  type="button"
                  onClick={() => setChannel('admin')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${
                    channel === 'admin'
                      ? 'bg-navy-50 text-navy-900 ring-navy-300'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Shield className="h-4 w-4" /> Yönetim / Admin
                </button>
              </div>
            </label>
            <label className="label sm:col-span-2">
              Konu
              <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Örn. Rapor hakkında soru" />
            </label>
            <label className="label sm:col-span-2">
              Mesaj
              <textarea
                className="input mt-1 min-h-[100px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Mesajınızı yazın…"
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button disabled={busy || !subject.trim() || !body.trim()} onClick={() => void startConversation()} icon={<Send className="h-4 w-4" />}>
                {busy ? 'Gönderiliyor…' : 'Gönder'}
              </Button>
              <Button variant="secondary" onClick={() => setComposeOpen(false)}>
                Vazgeç
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <Card>
          <CardHeader title="Konuşmalar" subtitle={`${sorted.length} kayıt`} icon={<MessageSquare className="h-5 w-5" />} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </p>
          ) : sorted.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                compact
                icon={<MessageSquare className="h-5 w-5" />}
                title="Henüz mesaj yok"
                text={isOwner ? 'Radyolog veya admin ile yeni bir konuşma başlatın.' : 'Size yöneltilmiş konuşma bulunmuyor.'}
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sorted.map((t) => {
                const active = threadId === t.thread_id
                return (
                  <li key={t.thread_id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/mesajlar/${t.thread_id}`)}
                      className={`flex w-full flex-col gap-1 px-5 py-3.5 text-left transition ${
                        active ? 'bg-teal-50/80' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-navy-900">{t.subject}</span>
                        {t.unread_count > 0 && (
                          <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                            {t.unread_count}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {CHANNEL_TR[t.channel]}
                        {!isOwner ? ` · ${t.owner_subject}` : ''}
                        {t.last_message_at ? ` · ${fmtDate(t.last_message_at)}` : ''}
                      </p>
                      {t.last_message_preview && (
                        <p className="line-clamp-2 text-xs text-slate-600">{t.last_message_preview}</p>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="min-h-[420px]">
          {!threadId ? (
            <div className="flex h-full min-h-[420px] items-center justify-center px-5">
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="Konuşma seçin"
                text="Soldan bir konuşma açın veya yeni mesaj başlatın."
              />
            </div>
          ) : detailLoading || !detail ? (
            <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Konuşma yükleniyor…
            </p>
          ) : (
            <>
              <CardHeader
                title={detail.thread.subject}
                subtitle={`${CHANNEL_TR[detail.thread.channel]} · ${detail.thread.owner_subject}`}
                icon={
                  detail.thread.channel === 'admin' ? (
                    <Shield className="h-5 w-5" />
                  ) : (
                    <Stethoscope className="h-5 w-5" />
                  )
                }
                action={
                  detail.thread.related_case_id ? (
                    <Link className="text-xs font-medium text-teal-700 hover:underline" to={`/vakalar/${detail.thread.related_case_id}`}>
                      Vakaya git
                    </Link>
                  ) : undefined
                }
              />
              <ul className="max-h-[360px] space-y-2.5 overflow-y-auto px-5 pb-3">
                {detail.messages.map((m) => {
                  const mine = me && m.author_subject === me
                  return (
                    <li
                      key={m.message_id}
                      className={`rounded-xl border px-3.5 py-2.5 text-sm ${
                        mine
                          ? 'ml-6 border-teal-200 bg-teal-50/70'
                          : 'mr-6 border-slate-100 bg-slate-50/90'
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="font-medium text-navy-800">
                          {authorLabel(m.author_role, m.author_subject)} · {m.author_subject}
                        </span>
                        <span>{fmtDate(m.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-navy-900">{m.body}</p>
                    </li>
                  )
                })}
              </ul>
              <div className="border-t border-slate-100 px-5 py-4">
                <label className="block">
                  <span className="label">Yanıt yazın</span>
                  <textarea
                    className="input mt-1 min-h-[84px]"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Mesajınız…"
                  />
                </label>
                <div className="mt-2 flex justify-end">
                  <Button
                    disabled={busy || !reply.trim()}
                    onClick={() => void sendReply()}
                    icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  >
                    Gönder
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
