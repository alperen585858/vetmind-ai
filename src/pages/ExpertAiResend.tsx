import { useEffect, useMemo, useRef, useState } from 'react'
import { LocalizedLink } from '../components/LocalizedLink'
import {
  Info,
  LayoutPanelLeft,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import {
  askCaseAiChat,
  clearCaseAiChat,
  listBackendWorklist,
  listCaseAiChat,
  PollingCancelledError,
  resendCaseToAI,
  type AiChatTurn,
} from '../lib/backend'
import { summaryToVetCase } from '../lib/caseMapper'
import type { BackendCaseSummary } from '../types'

const RESENDABLE_STATUSES = new Set([
  'created',
  'analyzing',
  'awaiting_review',
  'revision_requested',
  'rejected',
  'failed',
  'manual_review',
  // Ready / approved cases: resend opens a revision fork first, then re-analyzes.
  'approved',
])

type RunState = { phase: 'idle' | 'running' | 'done' | 'error'; message?: string }

export default function ExpertAiResend() {
  const { hydrateBackendCase, pushToast } = useApp()
  const { t } = useLocale()
  const [rows, setRows] = useState<BackendCaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [modality, setModality] = useState('')
  const [runById, setRunById] = useState<Record<string, RunState>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chat, setChat] = useState<AiChatTurn[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [chatElapsedSec, setChatElapsedSec] = useState(0)
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const abortByIdRef = useRef<Record<string, AbortController>>({})
  const chatAbortRef = useRef<AbortController | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    void listBackendWorklist({
      status: status || undefined,
      modality: modality || undefined,
      q: q || undefined,
    })
      .then(setRows)
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('ai.resend.listFailed'))
        setRows([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, modality])

  const display = useMemo(() => {
    const filtered = rows.filter((r) => RESENDABLE_STATUSES.has(String(r.status || '').toLowerCase()))
    return filtered.map(summaryToVetCase)
  }, [rows])

  const selected = display.find((c) => (c.backendCaseId || c.id) === selectedId) || null

  useEffect(() => {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setSending(false)
    if (!selectedId) {
      setChat([])
      return
    }
    let cancelled = false
    setChatLoading(true)
    void listCaseAiChat(selectedId)
      .then((history) => {
        if (!cancelled) setChat(history)
      })
      .catch((err) => {
        if (!cancelled) {
          setChat([])
          pushToast({
            tone: 'error',
            title: t('ai.resend.toastChatLoadFailed'),
            body: err instanceof Error ? err.message : undefined,
          })
        }
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, pushToast])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, sending])

  useEffect(() => {
    if (!sending) {
      setChatElapsedSec(0)
      return
    }
    setChatElapsedSec(0)
    const started = Date.now()
    const timer = window.setInterval(() => {
      setChatElapsedSec(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => window.clearInterval(timer)
  }, [sending])

  async function resend(caseId: string) {
    abortByIdRef.current[caseId]?.abort()
    const controller = new AbortController()
    abortByIdRef.current[caseId] = controller
    const row = rows.find((r) => r.case_id === caseId)
    const backendStatus = String(row?.status || '').toLowerCase()
    const openRevisionFirst = backendStatus === 'approved'
    setRunById((prev) => ({ ...prev, [caseId]: { phase: 'running' } }))
    try {
      if (openRevisionFirst) {
        pushToast({
          tone: 'info',
          title: t('ai.resend.toastRevisionOpening'),
          body: t('ai.resend.toastRevisionBody'),
        })
      }
      const result = await resendCaseToAI(caseId, {
        signal: controller.signal,
        cancelBackendOnAbort: true,
        openRevisionFirst,
      })
      await hydrateBackendCase(caseId)
      if (result.outcome === 'failed') {
        const msg = result.job.error_message || t('ai.resend.analysisFailedOutcome')
        setRunById((prev) => ({ ...prev, [caseId]: { phase: 'error', message: msg } }))
        pushToast({ tone: 'error', title: t('ai.resend.toastResendFailed'), body: msg })
        return
      }
      setRunById((prev) => ({
        ...prev,
        [caseId]: { phase: 'done', message: `Sonuç: ${result.outcome}` },
      }))
      pushToast({
        tone: 'success',
        title: t('ai.resend.toastResendOk'),
        body: openRevisionFirst ? t('ai.resend.toastResendBodyRevision') : t('ai.resend.toastResendBodyDraft'),
      })
      load()
    } catch (err) {
      if (err instanceof PollingCancelledError) {
        setRunById((prev) => ({ ...prev, [caseId]: { phase: 'idle' } }))
        pushToast({ tone: 'info', title: t('ai.resend.toastStopped') })
        await hydrateBackendCase(caseId)
        load()
        return
      }
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata'
      setRunById((prev) => ({ ...prev, [caseId]: { phase: 'error', message: msg } }))
      pushToast({ tone: 'error', title: t('ai.resend.toastResendSendFailed'), body: msg })
    } finally {
      if (abortByIdRef.current[caseId] === controller) delete abortByIdRef.current[caseId]
    }
  }

  function stopResend(caseId: string) {
    abortByIdRef.current[caseId]?.abort()
  }

  async function sendChat() {
    if (!selectedId || !draft.trim() || sending) return
    const text = draft.trim()
    setDraft('')
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    chatAbortRef.current = controller
    setSending(true)
    setChat((prev) => [...prev, { role: 'user', content: text }])
    try {
      const res = await askCaseAiChat(selectedId, text, { signal: controller.signal })
      setChat(res.history)
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError')
      if (aborted) {
        setChat((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'user' && m.content === text)))
        setDraft(text)
        pushToast({ tone: 'info', title: t('ai.resend.toastReplyStopped') })
        return
      }
      setChat((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'user' && m.content === text)))
      setDraft(text)
      pushToast({
        tone: 'error',
        title: t('ai.resend.toastReplyFailed'),
        body: err instanceof Error ? err.message : undefined,
      })
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      setSending(false)
    }
  }

  function stopChat() {
    chatAbortRef.current?.abort()
  }

  async function clearChat() {
    if (!selectedId) return
    try {
      await clearCaseAiChat(selectedId)
      setChat([])
      pushToast({ tone: 'info', title: t('ai.resend.toastChatCleared') })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('ai.resend.toastChatClearFailed'),
        body: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <>
      <PageHeader
        title={t('ai.resend.title')}
        subtitle={t('ai.resend.subtitle')}
        crumbs={[{ label: t('ai.resend.crumbDashboard'), to: '/' }, { label: t('ai.resend.title') }]}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            {t('common.refresh')}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="label" htmlFor="ai-resend-q">
            {t('common.search')}
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="ai-resend-q"
                className="input pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder={t('ai.resend.searchPlaceholder')}
              />
            </div>
          </label>
          <label className="label" htmlFor="ai-resend-status">
            {t('common.status')}
            <select id="ai-resend-status" className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('ai.resend.filterResendable')}</option>
              <option value="awaiting_review">{t('ai.resend.filterAwaitingReview')}</option>
              <option value="approved">{t('ai.resend.filterApproved')}</option>
              <option value="revision_requested">{t('ai.resend.filterRevision')}</option>
              <option value="failed">{t('ai.resend.filterFailed')}</option>
              <option value="rejected">{t('ai.resend.filterRejected')}</option>
              <option value="manual_review">{t('ai.resend.filterManual')}</option>
            </select>
          </label>
          <label className="label" htmlFor="ai-resend-modality">
            {t('cases.modality')}
            <select id="ai-resend-modality" className="input mt-1" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
              <option value="CR">CR</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button size="sm" onClick={load}>
              {t('common.filter')}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Card>
          <CardHeader
            title={t('ai.resend.caseCount', { count: String(display.length) })}
            subtitle={error ? `API: ${error}` : t('ai.resend.listHint')}
          />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('ai.resend.listLoading')}
            </p>
          ) : display.length === 0 ? (
            <EmptyState
              compact
              icon={<Sparkles className="h-5 w-5" />}
              title={t('ai.resend.emptyTitle')}
              text={t('ai.resend.emptyText')}
              action={
                <Button size="sm" variant="secondary" onClick={load}>
                  {t('common.refresh')}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="th">{t('ai.resend.colCase')}</th>
                    <th className="th">{t('ai.resend.colPatient')}</th>
                    <th className="th">{t('ai.resend.colStatus')}</th>
                    <th className="th">{t('ai.resend.colAi')}</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {display.map((c) => {
                    const caseId = c.backendCaseId || c.id
                    const run = runById[caseId] || { phase: 'idle' as const }
                    const busy = run.phase === 'running'
                    const analyzing = c.status === 'ai_analizi'
                    const active = selectedId === caseId
                    return (
                      <tr
                        key={c.id}
                        className={`cursor-pointer ${active ? 'bg-teal-50/80' : 'hover:bg-slate-50'}`}
                        onClick={() => setSelectedId(caseId)}
                      >
                        <td className="td font-mono text-xs">{c.no}</td>
                        <td className="td">
                          <p className="font-medium text-navy-900">{c.patient.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {c.modality || '—'} · <PriorityBadge priority={c.priority} />
                          </p>
                        </td>
                        <td className="td">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="td text-xs text-slate-600">
                          {run.phase === 'running' && (
                            <span className="inline-flex items-center gap-1 text-teal-700">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> …
                            </span>
                          )}
                          {run.phase === 'done' && <span className="text-emerald-700">{t('ai.resend.done')}</span>}
                          {run.phase === 'error' && <span className="text-rose-700">{t('ai.resend.error')}</span>}
                          {run.phase === 'idle' && '—'}
                        </td>
                        <td className="td" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              disabled={busy || analyzing}
                              onClick={() => void resend(caseId)}
                            >
                              {t('ai.resend.resendBtn')}
                            </Button>
                            {busy && (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Square className="h-3.5 w-3.5" />}
                                onClick={() => stopResend(caseId)}
                              >
                                {t('ai.resend.stop')}
                              </Button>
                            )}
                            <LocalizedLink
                              to={`/vakalar/${c.id}/calisma`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700"
                            >
                              <LayoutPanelLeft className="h-3.5 w-3.5" /> {t('ai.resend.workspaceLink')}
                            </LocalizedLink>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="flex min-h-[520px] flex-col overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              <Sparkles className="h-4 w-4 text-teal-600" /> {t('ai.resend.assistantTitle')}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {selected
                ? `${selected.patient.name} · ${selected.no}`
                : t('ai.resend.selectCaseHint')}
            </p>
          </div>

          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                compact
                icon={<Sparkles className="h-5 w-5" />}
                title={t('ai.resend.noCaseTitle')}
                text={t('ai.resend.noCaseText')}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-50 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={
                      (runById[selectedId]?.phase === 'running' && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )) || <Sparkles className="h-3.5 w-3.5" />
                    }
                    disabled={runById[selectedId]?.phase === 'running' || selected?.status === 'ai_analizi'}
                    onClick={() => void resend(selectedId)}
                  >
                    {t('ai.resend.resendBtn')}
                  </Button>
                  {runById[selectedId]?.phase === 'running' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Square className="h-3.5 w-3.5" />}
                      onClick={() => stopResend(selectedId)}
                    >
                      {t('review.workspace.stopAnalysis')}
                    </Button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => void clearChat()}
                  disabled={!chat.length}
                >
                  {t('ai.resend.clearChat')}
                </Button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4">
                {chatLoading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('ai.resend.chatLoading')}
                  </p>
                ) : chat.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-600">
                    <p className="font-medium text-navy-900">{t('ai.resend.sampleQuestions')}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                      <li>Bu vakadaki ana bulgular neler?</li>
                      <li>Ayırıcı tanıda nelere dikkat etmeliyim?</li>
                      <li>Taslak rapordaki belirsiz ifadeleri özetle.</li>
                    </ul>
                  </div>
                ) : (
                  chat.map((m, i) => (
                    <div
                      key={`${m.role}-${i}-${m.content.slice(0, 12)}`}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                          m.role === 'user'
                            ? 'bg-navy-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                          {m.role === 'user' ? t('ai.resend.you') : 'VetMind AI'}
                        </p>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('ai.resend.typing')}
                      <span className="font-mono tabular-nums text-slate-600">
                        {Math.floor(chatElapsedSec / 60)}:{String(chatElapsedSec % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <form
                className="flex gap-2 border-t border-slate-100 bg-white p-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (sending) {
                    stopChat()
                    return
                  }
                  void sendChat()
                }}
              >
                <input
                  className="input flex-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('ai.resend.questionPlaceholder')}
                  disabled={sending}
                  aria-label={t('ai.resend.questionAria')}
                />
                {sending ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={<Square className="h-3.5 w-3.5" />}
                    onClick={stopChat}
                  >
                    {t('ai.resend.stop')}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    icon={<Send className="h-3.5 w-3.5" />}
                    disabled={!draft.trim()}
                  >
                    {t('common.send')}
                  </Button>
                )}
              </form>
            </>
          )}
        </Card>
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" />
        {t('ai.resend.footerHint')}
      </p>
    </>
  )
}
