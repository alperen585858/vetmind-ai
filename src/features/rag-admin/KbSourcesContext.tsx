import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { KbSource } from '../../types'
import { KB_SOURCES } from './demoKb'
import { listCustomRagDocuments } from '../../lib/backend'
import { today } from '../../lib/format'
import { SESSION_RESET_EVENT, useAuth } from '../../shared/auth/AuthContext'

type KbSourcesContextValue = {
  kbSources: KbSource[]
  addKbSource: (s: KbSource) => void
  updateKbSource: (id: number, patch: Partial<KbSource>) => void
  sourceId: number | null
  openSource: (id: number) => void
  closeSource: () => void
}

const Ctx = createContext<KbSourcesContextValue | null>(null)

export function KbSourcesProvider({ children }: { children: ReactNode }) {
  const { session, role } = useAuth()
  const sessionEmail = session?.email
  const hasSession = session != null
  const [kbSources, setKb] = useState<KbSource[]>(KB_SOURCES)
  const [sourceId, setSourceId] = useState<number | null>(null)

  useEffect(() => {
    const onReset = () => setSourceId(null)
    window.addEventListener(SESSION_RESET_EVENT, onReset)
    return () => window.removeEventListener(SESSION_RESET_EVENT, onReset)
  }, [])

  // Merge seed KB with custom RAG documents so admin Modules / SourcePanel stay in sync with the API.
  useEffect(() => {
    if (!hasSession && !role) {
      setKb(KB_SOURCES)
      return
    }
    let cancelled = false
    void listCustomRagDocuments()
      .then((docs) => {
        if (cancelled) return
        const custom: KbSource[] = docs.map((d, i) => {
          const [type, license] = d.section.split(' · ')
          return {
            id: 20_000 + i,
            title: d.title,
            type: (['Kitap', 'Bilimsel yayın', 'VRM örnek rapor'].includes(type)
              ? type
              : 'Bilimsel yayın') as KbSource['type'],
            license: license === 'İzinli' ? 'İzinli' : 'Beklemede',
            section: d.section || 'Custom',
            passage: d.passage,
            chunks: 1,
            indexedAt: today(),
            keywords: d.keywords || [],
            ragApproved: Boolean(d.approved),
          }
        })
        setKb([...custom, ...KB_SOURCES])
      })
      .catch(() => {
        if (!cancelled) setKb(KB_SOURCES)
      })
    return () => {
      cancelled = true
    }
  }, [sessionEmail, hasSession, role])

  const addKbSource = useCallback((s: KbSource) => setKb((all) => [s, ...all]), [])
  const updateKbSource = useCallback(
    (id: number, patch: Partial<KbSource>) => setKb((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [],
  )
  const closeSource = useCallback(() => setSourceId(null), [])

  const value = useMemo<KbSourcesContextValue>(
    () => ({
      kbSources,
      addKbSource,
      updateKbSource,
      sourceId,
      openSource: setSourceId,
      closeSource,
    }),
    [kbSources, addKbSource, updateKbSource, sourceId, closeSource],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useKbSources() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useKbSources, KbSourcesProvider içinde kullanılmalı')
  return v
}
