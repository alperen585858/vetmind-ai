import { useEffect, useMemo, useRef, useState } from 'react'
import { LocalizedLink } from '../components/LocalizedLink'
import {
  ArrowUpRight,
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
import { STATUS_META, statusLabel } from '../components/StatusBadge'
import type { CaseStatus } from '../types'
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

  // Prefer a selected case so the stage is never a blank white void after load.
  useEffect(() => {
    if (loading || display.length === 0) return
    const stillThere = selectedId && display.some((c) => (c.backendCaseId || c.id) === selectedId)
    if (!stillThere) {
      const first = display[0]
      setSelectedId(first.backendCaseId || first.id)
    }
  }, [display, loading, selectedId])

  const selected = display.find((c) => (c.backendCaseId || c.id) === selectedId) || null
  // Latest selection, read inside async chat handlers to drop results for a case the user left.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const sampleQuestions = [t('ai.resend.sampleQ1'), t('ai.resend.sampleQ2'), t('ai.resend.sampleQ3')]

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
  }, [selectedId, pushToast, t])

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
        revisionComment: t('ai.resend.revisionComment'),
      })
      await hydrateBackendCase(caseId)
      if (result.outcome === 'failed') {
        const msg = result.job.error_message || t('ai.resend.analysisFailedOutcome')
        setRunById((prev) => ({ ...prev, [caseId]: { phase: 'error', message: msg } }))
        pushToast({
          tone: 'error',
          title: t('ai.resend.toastResendFailed'),
          body: openRevisionFirst ? `${msg} ${t('ai.resend.revisionLeftOpen')}` : msg,
        })
        return
      }
      setRunById((prev) => ({
        ...prev,
        [caseId]: { phase: 'done', message: t('ai.resend.resultLabel', { outcome: result.outcome }) },
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
        pushToast({
          tone: 'info',
          title: t('ai.resend.toastStopped'),
          body: openRevisionFirst ? t('ai.resend.revisionLeftOpen') : undefined,
        })
        await hydrateBackendCase(caseId)
        load()
        return
      }
      const msg = err instanceof Error ? err.message : t('ai.resend.unknownError')
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
    const caseAtSend = selectedId
    const stillOnCase = () => selectedIdRef.current === caseAtSend
    setDraft('')
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    chatAbortRef.current = controller
    setSending(true)
    setChat((prev) => [...prev, { role: 'user', content: text }])
    try {
      const res = await askCaseAiChat(caseAtSend, text, { signal: controller.signal })
      if (stillOnCase()) setChat(res.history)
    } catch (err) {
      // Switching case aborts the request: the question belongs to the old case, so
      // do not put it back into the composer of the new one.
      if (!stillOnCase()) return
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

  const selectedBusy = selectedId ? runById[selectedId]?.phase === 'running' : false
  const selectedAnalyzing = selected?.status === 'ai_analizi'
  const selectedMeta = selected ? STATUS_META[selected.status as CaseStatus] ?? STATUS_META.taslak : null

  return (
    <div className="vm-fade-up relative -mx-2 sm:-mx-1">
      {/* Viewport-locked shell: long case lists scroll inside; composer stays on screen. */}
      <div className="grid h-[calc(100dvh-7.5rem)] max-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-[1.75rem] shadow-[0_20px_50px_-28px_rgba(11,23,40,0.45)] xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        {/* Dark case rail */}
        <aside className="relative flex min-h-0 flex-col overflow-hidden bg-[color:var(--vm-midnight,#0b1728)] text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(45,212,191,0.22),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(14,165,233,0.12),transparent_40%)]"
          />
          <div className="relative border-b border-white/10 px-5 pb-4 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300/90">AI</p>
            <h1 className="mt-1 font-[family-name:var(--vm-font-display)] text-2xl font-semibold tracking-tight">
              {t('ai.resend.title')}
            </h1>
            <p className="mt-1 text-sm text-slate-300">{t('ai.resend.subtitle')}</p>

            <div className="mt-4 space-y-2">
              <label className="relative block">
                <span className="sr-only">{t('common.search')}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="ai-resend-q"
                  className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/15 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-400/50"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && load()}
                  placeholder={t('ai.resend.searchPlaceholder')}
                />
              </label>
              <div className="flex gap-2">
                <select
                  id="ai-resend-status"
                  aria-label={t('common.status')}
                  className="min-w-0 flex-1 rounded-xl border-0 bg-white/10 px-2.5 py-2 text-xs text-white outline-none ring-1 ring-white/15 focus:ring-2 focus:ring-teal-400/50 [&>option]:bg-navy-900 [&>option]:text-white"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">{t('ai.resend.filterResendable')}</option>
                  <option value="awaiting_review">{t('ai.resend.filterAwaitingReview')}</option>
                  <option value="approved">{t('ai.resend.filterApproved')}</option>
                  <option value="revision_requested">{t('ai.resend.filterRevision')}</option>
                  <option value="failed">{t('ai.resend.filterFailed')}</option>
                  <option value="rejected">{t('ai.resend.filterRejected')}</option>
                  <option value="manual_review">{t('ai.resend.filterManual')}</option>
                </select>
                <select
                  id="ai-resend-modality"
                  aria-label={t('cases.modality')}
                  className="rounded-xl border-0 bg-white/10 px-2.5 py-2 text-xs text-white outline-none ring-1 ring-white/15 focus:ring-2 focus:ring-teal-400/50 [&>option]:bg-navy-900 [&>option]:text-white"
                  value={modality}
                  onChange={(e) => setModality(e.target.value)}
                >
                  <option value="">{t('common.all')}</option>
                  <option value="MR">MR</option>
                  <option value="CT">CT</option>
                  <option value="XR">XR</option>
                  <option value="CR">CR</option>
                </select>
                <button
                  type="button"
                  onClick={load}
                  disabled={loading}
                  title={t('common.refresh')}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-400 text-navy-950 transition hover:bg-teal-300 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                </button>
              </div>
            </div>
          </div>

          <div className="relative flex items-center justify-between px-5 py-3">
            <p className="text-xs font-semibold text-slate-300">
              {t('ai.resend.caseCount', { count: String(display.length) })}
            </p>
            <p className="text-[11px] text-slate-500">{t('ai.resend.listHint')}</p>
          </div>

          {error && (
            <p className="relative mx-4 mb-2 rounded-xl bg-amber-400/15 px-3 py-2 text-xs text-amber-100" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="relative flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-slate-400" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-teal-300" aria-hidden />
              {t('ai.resend.listLoading')}
            </p>
          ) : display.length === 0 ? (
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-6 text-center">
              <div>
                <p className="font-[family-name:var(--vm-font-display)] text-base font-semibold">{t('ai.resend.emptyTitle')}</p>
                <p className="mt-1 text-sm text-slate-400">{t('ai.resend.emptyText')}</p>
              </div>
            </div>
          ) : (
            <ul
              className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-4"
              role="listbox"
              aria-label={t('ai.resend.caseCount', { count: String(display.length) })}
            >
              {display.map((c) => {
                const caseId = c.backendCaseId || c.id
                const run = runById[caseId] || { phase: 'idle' as const }
                const busy = run.phase === 'running'
                const active = selectedId === caseId
                const meta = STATUS_META[c.status as CaseStatus] ?? STATUS_META.taslak
                return (
                  <li key={c.id} className="flex gap-1">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelectedId(caseId)}
                      className={`group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                        active
                          ? 'bg-gradient-to-r from-teal-400 to-teal-500 text-navy-950 shadow-lg shadow-teal-900/30'
                          : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-wide ${
                          active ? 'bg-navy-950/15 text-navy-950' : 'bg-white/10 text-teal-200'
                        }`}
                      >
                        {(c.modality || '—').slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${active ? 'text-navy-950' : 'text-white'}`}>
                          {c.patient.name}
                        </span>
                        <span className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${active ? 'text-navy-900/70' : 'text-slate-400'}`}>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                          <span className="truncate">{statusLabel(c.status, t)}</span>
                          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          {run.phase === 'done' && <span>· {t('ai.resend.done')}</span>}
                          {run.phase === 'error' && <span>· {t('ai.resend.error')}</span>}
                        </span>
                      </span>
                    </button>
                    {busy && (
                      <button
                        type="button"
                        onClick={() => stopResend(caseId)}
                        className="shrink-0 self-center rounded-xl px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
                      >
                        {t('ai.resend.stop')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Light stage */}
        <section className="relative flex min-h-0 flex-col overflow-hidden bg-gradient-to-br from-[#f3fbfa] via-white to-[#eef6fb]">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full bg-teal-300/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-10 -left-10 h-40 w-40 rounded-full bg-cyan-300/15 blur-3xl"
          />

          {!selectedId || !selected ? (
            <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-teal-500 to-cyan-500 text-white shadow-xl shadow-teal-600/30">
                <Sparkles className="h-9 w-9" aria-hidden />
              </div>
              <div>
                <p className="font-[family-name:var(--vm-font-display)] text-2xl font-semibold text-navy-950">
                  {t('ai.resend.noCaseTitle')}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{t('ai.resend.noCaseText')}</p>
              </div>
            </div>
          ) : (
            <>
              <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-teal-900/5 px-6 py-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-[family-name:var(--vm-font-display)] text-2xl font-semibold tracking-tight text-navy-950">
                      {selected.patient.name}
                    </h2>
                    <span className="rounded-lg bg-teal-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal-800">
                      {selected.modality || '—'}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{selected.no}</span>
                    {selectedMeta && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${selectedMeta.dot}`} aria-hidden />
                          {statusLabel(selected.status, t)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedBusy ? (
                    <Button size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={() => stopResend(selectedId)}>
                      {t('ai.resend.stop')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      icon={<Sparkles className="h-3.5 w-3.5" />}
                      disabled={selectedAnalyzing}
                      onClick={() => void resend(selectedId)}
                    >
                      {t('ai.resend.resendBtn')}
                    </Button>
                  )}
                  <LocalizedLink
                    to={`/vakalar/${selected.id}/calisma`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-teal-800 ring-1 ring-teal-900/10 transition hover:bg-white hover:ring-teal-500/30"
                  >
                    <LayoutPanelLeft className="h-3.5 w-3.5" aria-hidden />
                    {t('ai.resend.workspaceLink')}
                  </LocalizedLink>
                  <button
                    type="button"
                    onClick={() => void clearChat()}
                    disabled={!chat.length}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:opacity-30"
                    title={t('ai.resend.clearChat')}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </header>

              <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-4">
                {chatLoading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-teal-600" aria-hidden />
                    {t('ai.resend.chatLoading')}
                  </p>
                ) : chat.length === 0 ? (
                  <div className="mx-auto w-full max-w-xl">
                    <p className="font-[family-name:var(--vm-font-display)] text-base font-semibold text-navy-950">
                      {t('ai.resend.assistantTitle')}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">{t('ai.resend.sampleQuestions')}</p>
                    <div className="mt-3 space-y-2">
                      {sampleQuestions.map((qText) => (
                        <button
                          key={qText}
                          type="button"
                          onClick={() => setDraft(qText)}
                          className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left text-sm font-medium text-navy-900 shadow-sm ring-1 ring-slate-200/70 transition hover:ring-teal-400/40"
                        >
                          <span>{qText}</span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-teal-600 opacity-60 group-hover:opacity-100" aria-hidden />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.map((m, i) => (
                    <div
                      key={`${m.role}-${i}-${m.content.slice(0, 12)}`}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed shadow-sm ${
                          m.role === 'user'
                            ? 'rounded-2xl rounded-br-md bg-[color:var(--vm-midnight,#0b1728)] text-white'
                            : 'rounded-2xl rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200/80'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200/80">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" aria-hidden />
                      {t('ai.resend.typing')}
                      <span className="font-mono tabular-nums">
                        {Math.floor(chatElapsedSec / 60)}:{String(chatElapsedSec % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <form
                className="relative shrink-0 border-t border-teal-900/5 bg-white/95 px-6 pb-4 pt-3 backdrop-blur"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (sending) {
                    stopChat()
                    return
                  }
                  void sendChat()
                }}
              >
                <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl bg-white p-1.5 shadow-md shadow-teal-900/5 ring-1 ring-slate-200/70 transition focus-within:ring-2 focus-within:ring-teal-500/35">
                  <input
                    className="min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-sm text-navy-900 outline-none placeholder:text-slate-400"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t('ai.resend.questionPlaceholder')}
                    disabled={sending}
                    aria-label={t('ai.resend.questionAria')}
                  />
                  {sending ? (
                    <Button type="button" size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={stopChat}>
                      {t('ai.resend.stop')}
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" icon={<Send className="h-3.5 w-3.5" />} disabled={!draft.trim()}>
                      {t('common.send')}
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-center text-[11px] text-slate-400">{t('ai.resend.footerHint')}</p>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
