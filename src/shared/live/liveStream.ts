import { useEffect, useRef, useSyncExternalStore } from 'react'
import { API_BASE, request } from '../api/client'

/**
 * One Server-Sent Events connection per signed-in tab (new messages, delete/undo, read
 * receipts, typing, notifications). EventSource cannot send an Authorization header, so we
 * first fetch a single-use ticket with the normal API client, then open the stream.
 * A used ticket cannot reconnect, so on error we close and reconnect with a fresh ticket.
 */

export type LiveEvent = { type: string; thread_id?: string; [key: string]: unknown }
type Listener = (event: LiveEvent) => void
export type LiveStatus = 'idle' | 'connecting' | 'open' | 'retrying'

const EVENT_TYPES = [
  'ready',
  'resync',
  'thread.created',
  'thread.read',
  'thread.deleted',
  'message.created',
  'message.deleted',
  'message.restored',
  'typing',
  'notification',
] as const

const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000]

const listeners = new Set<Listener>()
const statusListeners = new Set<() => void>()
let source: EventSource | null = null
let status: LiveStatus = 'idle'
let wanted = false
let attempt = 0
let retryTimer: number | undefined
// Bumped on every start/stop so a connect() that was waiting for its ticket can tell it is stale.
let generation = 0

function setStatus(next: LiveStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((l) => l())
}

function emit(event: LiveEvent) {
  listeners.forEach((l) => {
    try {
      l(event)
    } catch {
      /* a broken listener must not stop the others */
    }
  })
}

function scheduleRetry() {
  if (!wanted) return
  setStatus('retrying')
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
  attempt += 1
  window.clearTimeout(retryTimer)
  const gen = generation
  retryTimer = window.setTimeout(() => {
    if (gen === generation) void connect()
  }, delay)
}

async function connect() {
  if (!wanted || typeof EventSource === 'undefined') return
  const gen = generation
  source?.close()
  source = null
  setStatus('connecting')
  let ticket: string
  try {
    ticket = (await request<{ ticket: string }>('/messages/stream-ticket', { method: 'POST' })).ticket
  } catch {
    scheduleRetry()
    return
  }
  if (!wanted || gen !== generation) return
  const es = new EventSource(`${API_BASE}/live/stream?ticket=${encodeURIComponent(ticket)}`)
  source = es
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e) => {
      let data: LiveEvent = { type }
      try {
        data = { type, ...JSON.parse((e as MessageEvent<string>).data) }
      } catch {
        /* keep bare type */
      }
      if (type === 'ready') {
        attempt = 0
        setStatus('open')
      }
      emit(data)
    })
  }
  es.onerror = () => {
    es.close()
    if (source !== es) return // replaced or stopped already
    source = null
    // Anything missed while offline is picked up by a resync after reconnecting.
    scheduleRetry()
  }
}

export function startLiveStream() {
  if (wanted) return
  wanted = true
  attempt = 0
  generation += 1
  void connect()
}

export function stopLiveStream() {
  wanted = false
  generation += 1
  window.clearTimeout(retryTimer)
  source?.close()
  source = null
  setStatus('idle')
}

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Call ``handler`` for live events (always the latest handler; no re-subscribe churn). */
export function useLiveEvents(handler: Listener) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => subscribeLive((e) => ref.current(e)), [])
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    () => status,
    () => 'idle',
  )
}

/** Mount once inside the signed-in layout. */
export function LiveStreamConnector({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return
    startLiveStream()
    return () => stopLiveStream()
  }, [enabled])
  return null
}
