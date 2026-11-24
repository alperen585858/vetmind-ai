import { useSyncExternalStore } from 'react'
import {
  confirmDicomAndEnqueueAnalyze,
  getAnalysisJob,
  uploadDicomDemo,
  uploadDicomFiles,
  type BackendAnalysisJob,
} from '../../shared/api'
import { displayAnalysisProgress, estimateAnalysisDurationMs } from '../../shared/lib/analysisProgress'
import type { AnalyzeHandoff } from '../../shared/lib/analyzeHandoff'
import type { DicomUploadResponse } from '../../shared/types'

/**
 * Background AI analyses that outlive the page that started them.
 *
 * "Analize gönder" used to run upload → confirm → enqueue → polling inside the Processing
 * page, so leaving the page aborted it and the pending case vanished. Tasks now run here,
 * at module level; any page can read them (top-bar progress pill, dashboard banner,
 * Processing page). Once a job is queued its ids go to sessionStorage, so a full reload
 * keeps tracking it (the upload itself cannot survive a reload).
 */

export type TaskPhase = 'uploading' | 'queuing' | 'analyzing' | 'completed' | 'failed' | 'cancelled'

export interface AnalysisTask {
  /** pending-… id while uploading, then stays the same key. */
  key: string
  pendingId?: string
  caseId?: string
  jobId?: string
  patientName: string
  phase: TaskPhase
  backendPct?: number | null
  jobStatus?: string
  stage?: string | null
  startedAt: number
  estimatedMs: number
  instanceCount?: number
  error?: string
  /** Set once the bridge has turned the pending case into the real one. */
  created?: { handoff: AnalyzeHandoff; job: BackendAnalysisJob; uploadSnap: DicomUploadResponse | null; caseRecord: unknown }
  createdHandled?: boolean
  finishedHandled?: boolean
  seen?: boolean
}

const STORAGE_KEY = 'vetmind.analysisTasks'
const POLL_MS = 1500
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out'])

let tasks: AnalysisTask[] = []
const listeners = new Set<() => void>()
const polling = new Set<string>()

function emit() {
  tasks = [...tasks]
  persist()
  listeners.forEach((l) => l())
}

function patch(key: string, update: Partial<AnalysisTask>) {
  tasks = tasks.map((t) => (t.key === key ? { ...t, ...update } : t))
  emit()
}

function persist() {
  try {
    const keep = tasks
      .filter((t) => t.caseId && t.jobId)
      .map(({ key, caseId, jobId, patientName, phase, startedAt, estimatedMs, instanceCount, seen, backendPct, jobStatus }) => ({
        key,
        caseId,
        jobId,
        patientName,
        phase,
        startedAt,
        estimatedMs,
        instanceCount,
        seen,
        backendPct,
        jobStatus,
        createdHandled: true,
        finishedHandled: phase !== 'analyzing',
      }))
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(keep))
  } catch {
    /* private mode / quota — tracking just won't survive a reload */
  }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    tasks = (JSON.parse(raw) as AnalysisTask[]).filter((t) => t.key && t.caseId && t.jobId)
    for (const t of tasks) if (t.phase === 'analyzing') void poll(t.key)
  } catch {
    tasks = []
  }
}

async function poll(key: string) {
  if (polling.has(key)) return
  polling.add(key)
  try {
    for (;;) {
      const task = tasks.find((t) => t.key === key)
      if (!task?.jobId || task.phase !== 'analyzing') return
      try {
        const job = await getAnalysisJob(task.jobId)
        const done = TERMINAL.has(job.status)
        patch(key, {
          backendPct: job.progress_pct,
          jobStatus: job.status,
          stage: job.pipeline_stage ?? job.stage_label ?? null,
          ...(done
            ? {
                phase: job.status === 'completed' ? 'completed' : job.status === 'cancelled' ? 'cancelled' : 'failed',
                seen: false,
              }
            : {}),
        })
        if (done) return
      } catch {
        /* transient network error — keep polling */
      }
      await new Promise((r) => window.setTimeout(r, POLL_MS))
    }
  } finally {
    polling.delete(key)
  }
}

/** Start (once) the upload → enqueue → tracking for a handoff from the DICOM page. */
export function startHandoffTask(handoff: AnalyzeHandoff, messages: { blocked: string }): void {
  if (tasks.some((t) => t.key === handoff.pendingId)) return
  const instanceCount =
    handoff.uploadSnap?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? (handoff.files.length || 1)
  tasks = [
    ...tasks,
    {
      key: handoff.pendingId,
      pendingId: handoff.pendingId,
      patientName: handoff.patientName,
      phase: handoff.ingestId ? 'queuing' : 'uploading',
      startedAt: Date.now(),
      estimatedMs: estimateAnalysisDurationMs(instanceCount),
      instanceCount,
    },
  ]
  emit()

  void (async () => {
    const key = handoff.pendingId
    try {
      let ingestId = handoff.ingestId
      let uploadSnap = handoff.uploadSnap
      if (!ingestId) {
        const upload = handoff.pendingDemo
          ? await uploadDicomDemo({
              kind: handoff.pendingDemo,
              patientName: handoff.patientName,
              species: handoff.species,
              breed: handoff.breed,
              clinicalHistory: handoff.history,
            })
          : await uploadDicomFiles({
              files: handoff.files,
              patientName: handoff.patientName,
              species: handoff.species,
              breed: handoff.breed,
              clinicalHistory: handoff.history,
            })
        uploadSnap = upload
        if (upload.blocked) throw new Error(upload.block_reason || messages.blocked)
        ingestId = upload.ingest_id
        patch(key, { phase: 'queuing' })
      }
      const { case: caseRecord, job } = await confirmDicomAndEnqueueAnalyze({
        ingestId,
        acceptSuggestion: handoff.acceptSuggestion,
        modality: handoff.acceptSuggestion ? undefined : handoff.overrideModality,
        anatomicalRegion: handoff.acceptSuggestion ? undefined : handoff.overrideRegion,
        patientName: handoff.patientName,
        clinicalHistory: handoff.history,
        ownerName: handoff.ownerName,
        imagingSourcePermissionVerified: handoff.consent,
        imagingAnalysisConsentVerified: handoff.consent,
      })
      const count =
        uploadSnap?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? tasks.find((t) => t.key === key)?.instanceCount
      patch(key, {
        caseId: caseRecord.case_id,
        jobId: job.job_id,
        phase: 'analyzing',
        jobStatus: job.status,
        backendPct: job.progress_pct,
        startedAt: Date.now(),
        estimatedMs: estimateAnalysisDurationMs(count),
        instanceCount: count,
        created: { handoff, job, uploadSnap, caseRecord },
      })
      void poll(key)
    } catch (err) {
      patch(key, { phase: 'failed', error: err instanceof Error ? err.message : String(err), seen: false })
    }
  })()
}

/** Track a job started elsewhere (e.g. "retry" on the Processing page). */
export function trackAnalysisJob(input: { caseId: string; jobId: string; patientName: string; instanceCount?: number }) {
  const existing = tasks.find((t) => t.caseId === input.caseId)
  const fresh: AnalysisTask = {
    key: existing?.key ?? input.caseId,
    caseId: input.caseId,
    jobId: input.jobId,
    patientName: input.patientName,
    phase: 'analyzing',
    startedAt: Date.now(),
    estimatedMs: estimateAnalysisDurationMs(input.instanceCount),
    instanceCount: input.instanceCount,
    createdHandled: true,
  }
  tasks = existing ? tasks.map((t) => (t.key === existing.key ? fresh : t)) : [...tasks, fresh]
  emit()
  void poll(fresh.key)
}

export function markTask(key: string, update: Pick<AnalysisTask, 'createdHandled' | 'finishedHandled' | 'seen'>) {
  patch(key, update)
}

export function dismissTask(key: string) {
  tasks = tasks.filter((t) => t.key !== key)
  emit()
}

export function findTask(id: string): AnalysisTask | undefined {
  return tasks.find((t) => t.key === id || t.pendingId === id || t.caseId === id)
}

/** Smoothed 0–100 for display (same curve as the Processing page). */
export function taskProgress(task: AnalysisTask, nowMs = Date.now()): number {
  if (task.phase === 'completed') return 100
  if (task.phase === 'uploading') return Math.min(18, 4 + ((nowMs - task.startedAt) / 8000) * 14)
  if (task.phase === 'queuing') return Math.min(28, 18 + ((nowMs - task.startedAt) / 6000) * 10)
  return Math.round(
    displayAnalysisProgress({
      backendPct: task.backendPct,
      startedAtMs: task.startedAt,
      estimatedMs: task.estimatedMs,
      instanceCount: task.instanceCount,
      status: task.jobStatus ?? 'running',
      nowMs,
    }),
  )
}

/** Where the pill / banner should take the user. */
export function taskPath(task: AnalysisTask): string {
  return `/vakalar/${task.caseId ?? task.pendingId ?? task.key}/isleme`
}

export function useAnalysisTasks(): AnalysisTask[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => tasks,
    () => tasks,
  )
}

if (typeof window !== 'undefined') restore()
