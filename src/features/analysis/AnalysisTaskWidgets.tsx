import { useEffect, useRef, useState } from 'react'
import { Brain, CheckCircle2, ChevronRight, Loader2, X, XCircle } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { clearAnalyzeHandoff } from '../../shared/lib/analyzeHandoff'
import { cacheCaseDicomFiles } from '../../shared/lib/dicomCaseCache'
import { MAX_VIEWER_FRAMES } from '../../shared/lib/dicomFolder'
import {
  dismissTask,
  markTask,
  taskPath,
  taskProgress,
  useAnalysisTasks,
  type AnalysisTask,
} from './analysisTasks'
import { buildCaseFromHandoff } from './lib/caseFromHandoff'

const ACTIVE = new Set(['uploading', 'queuing', 'analyzing'])

function useTicker(active: boolean, ms = 500) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setN((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
}

/**
 * Applies background-task results to app state, wherever the user is: turns the pending
 * case into the real one once queued, and refreshes the case + shows a toast when done.
 */
export function AnalysisTaskBridge() {
  const { addCase, removeCase, getCase, hydrateBackendCase, pushToast } = useApp()
  const { t, locale } = useLocale()
  const tasks = useAnalysisTasks()

  useEffect(() => {
    for (const task of tasks) {
      if (task.created && !task.createdHandled && task.caseId) {
        markTask(task.key, { createdHandled: true })
        const { handoff, job, uploadSnap, caseRecord } = task.created
        const newCase = buildCaseFromHandoff(
          handoff,
          caseRecord as Parameters<typeof buildCaseFromHandoff>[1],
          job,
          uploadSnap,
          locale,
          t,
        )
        if (handoff.files.length > 0) void cacheCaseDicomFiles(newCase.id, handoff.files.slice(0, MAX_VIEWER_FRAMES))
        if (!getCase(newCase.id)) addCase(newCase)
        clearAnalyzeHandoff(handoff.pendingId)
        removeCase(handoff.pendingId)
        pushToast({ tone: 'info', title: t('cases.processing.sentToAi'), body: `${task.patientName} · ${t('analysisTasks.keepWorking')}` })
      }
      if (!ACTIVE.has(task.phase) && !task.finishedHandled) {
        markTask(task.key, { finishedHandled: true })
        if (task.caseId) void hydrateBackendCase(task.caseId)
        if (task.phase === 'completed') {
          pushToast({ tone: 'success', title: t('analysisTasks.doneTitle'), body: task.patientName })
        } else if (task.phase === 'failed') {
          pushToast({ tone: 'error', title: t('analysisTasks.failedTitle'), body: task.error || task.patientName })
        }
      }
    }
  }, [tasks, addCase, removeCase, getCase, hydrateBackendCase, pushToast, t, locale])

  return null
}

function TaskStatusText({ task }: { task: AnalysisTask }) {
  const { t } = useLocale()
  if (task.phase === 'completed') return <>{t('analysisTasks.done')}</>
  if (task.phase === 'failed') return <>{t('analysisTasks.failed')}</>
  if (task.phase === 'cancelled') return <>{t('analysisTasks.cancelled')}</>
  if (task.phase === 'uploading') return <>{t('analysisTasks.uploading')}</>
  if (task.phase === 'queuing') return <>{t('analysisTasks.queuing')}</>
  return <>{t('analysisTasks.analyzing')}</>
}

function ProgressRing({ pct, phase }: { pct: number; phase: AnalysisTask['phase'] }) {
  if (phase === 'completed') return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
  if (phase === 'failed' || phase === 'cancelled') return <XCircle className="h-5 w-5 text-rose-600" aria-hidden />
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-teal-100" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className="text-teal-600 transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  )
}

/** Top-bar pill: live % for running analyses; click goes to the analysis page. */
export function AnalysisTasksIndicator() {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const tasks = useAnalysisTasks()
  const anyActive = tasks.some((x) => ACTIVE.has(x.phase))
  useTicker(anyActive)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (tasks.length === 0) return null

  const go = (task: AnalysisTask) => {
    setOpen(false)
    nav(taskPath(task))
    if (!ACTIVE.has(task.phase)) dismissTask(task.key)
  }

  // Show the running one first, otherwise the latest finished one.
  const lead = tasks.find((x) => ACTIVE.has(x.phase)) ?? tasks[tasks.length - 1]
  const pct = taskProgress(lead)
  const done = lead.phase === 'completed'
  const bad = lead.phase === 'failed' || lead.phase === 'cancelled'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => (tasks.length > 1 ? setOpen((o) => !o) : go(lead))}
        className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
          done
            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
            : bad
              ? 'bg-rose-50 text-rose-800 ring-rose-200 hover:bg-rose-100'
              : 'bg-teal-50 text-teal-900 ring-teal-200 hover:bg-teal-100'
        }`}
        aria-label={t('analysisTasks.pillLabel', { name: lead.patientName, pct: String(pct) })}
        aria-haspopup={tasks.length > 1 ? 'menu' : undefined}
        aria-expanded={tasks.length > 1 ? open : undefined}
      >
        <ProgressRing pct={pct} phase={lead.phase} />
        <span className="hidden max-w-[9rem] truncate sm:inline">{lead.patientName}</span>
        <span className="tabular-nums">{done ? t('analysisTasks.readyShort') : bad ? t('analysisTasks.failedShort') : `%${pct}`}</span>
        {tasks.length > 1 && (
          <span className="rounded-full bg-white/80 px-1.5 text-[10px] text-slate-700 ring-1 ring-slate-200">{tasks.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200" role="menu">
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('analysisTasks.title')}
          </p>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {tasks.map((task) => (
              <TaskRow key={task.key} task={task} onOpen={() => go(task)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onOpen }: { task: AnalysisTask; onOpen: () => void }) {
  const { t } = useLocale()
  const pct = taskProgress(task)
  const active = ACTIVE.has(task.phase)
  return (
    <li className="flex items-center gap-2 px-3 py-2.5">
      <button type="button" role="menuitem" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <ProgressRing pct={pct} phase={task.phase} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-navy-900">{task.patientName}</span>
          <span className="block text-xs text-slate-500">
            <TaskStatusText task={task} />
            {active ? ` · %${pct}` : ''}
          </span>
          {active && (
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-teal-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
      </button>
      {!active && (
        <button
          type="button"
          onClick={() => dismissTask(task.key)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label={t('analysisTasks.dismiss')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

/** Dashboard banner listing running / finished analyses with progress bars. */
export function AnalysisTasksBanner() {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const tasks = useAnalysisTasks()
  useTicker(tasks.some((x) => ACTIVE.has(x.phase)))
  if (tasks.length === 0) return null
  return (
    <div className="space-y-2" aria-live="polite">
      {tasks.map((task) => {
        const pct = taskProgress(task)
        const active = ACTIVE.has(task.phase)
        const done = task.phase === 'completed'
        return (
          <div
            key={task.key}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-soft ${
              done ? 'border-emerald-200 bg-emerald-50' : active ? 'border-teal-200 bg-white' : 'border-rose-200 bg-rose-50'
            }`}
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-teal-50 text-teal-700' : 'bg-rose-100 text-rose-700'}`}>
              {active ? <Brain className="h-5 w-5" /> : done ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            </span>
            <button
              type="button"
              onClick={() => {
                nav(taskPath(task))
                if (!active) dismissTask(task.key)
              }}
              className="min-w-0 flex-1 text-left"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold text-navy-900">
                  {t('analysisTasks.bannerTitle', { name: task.patientName })}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-navy-900">
                  {active ? `%${pct}` : done ? t('analysisTasks.readyShort') : t('analysisTasks.failedShort')}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
                {active && <Loader2 className="h-3 w-3 animate-spin" />}
                <TaskStatusText task={task} />
                <span className="text-slate-400">· {t('analysisTasks.openHint')}</span>
                <ChevronRight className="h-3 w-3" />
              </span>
              {active && (
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </span>
              )}
            </button>
            {!active && (
              <button
                type="button"
                onClick={() => dismissTask(task.key)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
                aria-label={t('analysisTasks.dismiss')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
