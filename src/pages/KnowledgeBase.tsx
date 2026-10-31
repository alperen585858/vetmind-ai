import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Loader2, Plus, Search, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import {
  BackendUnavailableError,
  addRagDocument,
  bulkRagDocuments,
  listCustomRagDocuments,
  searchRag,
  type RagCustomDocument,
} from '../lib/backend'
import { getKbSources, kbLicenseLabel, kbSourceText, kbTypeLabel } from '../data/mock'
import { fmtDate, today } from '../lib/format'
import type { KbSource } from '../types'

interface Hit {
  source: KbSource
  score: number
  backend?: boolean
}

const SUGGESTIONS = ['Dachshund akut disk ekstrüzyonu', 'FKE ağrısız mı', 'kedide nöbet idiyopatik epilepsi', 'derin ağrı prognoz']

function localSearch(q: string, sources: KbSource[]): Hit[] {
  const tokens = q.toLocaleLowerCase('tr').split(/[\s,.;:?!]+/).filter((t) => t.length >= 2)
  return sources
    .filter((s) => !s.indexing)
    .map((s) => {
      const hay = `${s.title} ${s.section} ${s.passage} ${s.keywords.join(' ')}`.toLocaleLowerCase('tr')
      const hits = tokens.filter((t) => hay.includes(t)).length
      const jitter = ((s.id * 13) % 7) / 100
      const score = hits ? Math.min(0.97, 0.7 + 0.07 * hits + jitter) : 0.41 + ((s.id * 17) % 22) / 100
      return { source: s, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

// Type and license have no backend field; they travel in the section as "Tür · Lisans".
function fromBackendDoc(d: RagCustomDocument, i: number): KbSource {
  const [type, license] = d.section.split(' · ')
  return {
    id: 20_000 + i,
    title: d.title,
    type: (['Kitap', 'Bilimsel yayın', 'VRM örnek rapor'].includes(type) ? type : 'Bilimsel yayın') as KbSource['type'],
    license: license === 'İzinli' ? 'İzinli' : 'Beklemede',
    section: 'Eklenen kaynak',
    passage: d.passage,
    chunks: 1,
    indexedAt: today(),
    keywords: d.keywords,
    ragApproved: Boolean(d.approved),
  }
}

export default function KnowledgeBase() {
  const { t, intlLocale, locale } = useLocale()
  const { kbSources: seedSources, pushToast, openSource } = useApp()
  const [custom, setCustom] = useState<KbSource[]>([])
  const [saving, setSaving] = useState(false)
  const localizedSeeds = useMemo(() => getKbSources(locale, seedSources), [locale, seedSources])
  const kbSources = [...custom, ...localizedSeeds]

  useEffect(() => {
    void listCustomRagDocuments()
      .then((docs) => setCustom(docs.map(fromBackendDoc)))
      .catch(() => setCustom([]))
  }, [])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [modal, setModal] = useState(false)
  const emptyForm = { title: '', passage: '', type: 'Bilimsel yayın' as KbSource['type'], license: 'Beklemede' as KbSource['license'] }
  const [form, setForm] = useState(emptyForm)
  const [bulkLoading, setBulkLoading] = useState(false)
  const bulkInputRef = useRef<HTMLInputElement>(null)

  const run = (query = q) => {
    if (!query.trim()) return
    setQ(query)
    setLoading(true)
    setHits(null)
    void (async () => {
      try {
        const res = await searchRag(query, 5)
        setHits(
          res.hits.map((h, i) => ({
            source: {
              id: 10_000 + i,
              title: h.title,
              type: 'Bilimsel yayın',
              license: 'İzinli',
              section: h.section,
              passage: h.passage,
              chunks: 1,
              indexedAt: today(),
              keywords: [],
            },
            score: h.score,
            backend: true,
          })),
        )
      } catch (err) {
        setHits(localSearch(query, kbSources))
        if (!(err instanceof BackendUnavailableError)) {
          pushToast({ tone: 'warning', title: 'Backend RAG yok', body: 'Yerel arama kullanıldı.' })
        }
      } finally {
        setLoading(false)
      }
    })()
  }

  const add = async () => {
    setSaving(true)
    try {
      await addRagDocument({ title: form.title.trim(), section: `${form.type} · ${form.license}`, passage: form.passage.trim() })
      const docs = await listCustomRagDocuments()
      setCustom(docs.map(fromBackendDoc))
      setModal(false)
      setForm(emptyForm)
      pushToast({
        tone: 'success',
        title: 'Kaynak indekslendi',
        body: 'Demo vektör deposuna eklendi; klinik onaylı bilgi bankası değildir.',
      })
    } catch (err) {
      pushToast({ tone: 'error', title: 'Kaynak eklenemedi', body: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('admin.kbTitle')}
        subtitle={t('admin.kbSubtitle', { count: kbSources.length })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal(true)}>
              {t('admin.addSource')}
            </Button>
            <input
              ref={bulkInputRef}
              type="file"
              accept=".jsonl,application/json"
              className="sr-only"
              disabled={bulkLoading}
              onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setBulkLoading(true)
                  void file
                    .text()
                    .then((raw) => {
                      const lines = raw.split(/\r?\n/).filter((l) => l.trim())
                      const documents = lines.map((line) => JSON.parse(line) as {
                        title: string
                        section?: string
                        passage: string
                        keywords?: string[]
                        approved?: boolean
                      })
                      return bulkRagDocuments(
                        documents.map((d) => ({
                          title: d.title,
                          section: d.section ?? 'Bulk',
                          passage: d.passage,
                          keywords: d.keywords,
                          approved: d.approved ?? false,
                        })),
                      )
                    })
                    .then(async (res) => {
                      const docs = await listCustomRagDocuments()
                      setCustom(docs.map(fromBackendDoc))
                      pushToast({
                        tone: 'success',
                        title: `${res.added} kaynak toplu eklendi`,
                        body: res.note,
                      })
                    })
                    .catch((err) =>
                      pushToast({
                        tone: 'error',
                        title: 'Toplu yükleme başarısız',
                        body: err instanceof Error ? err.message : undefined,
                      }),
                    )
                    .finally(() => setBulkLoading(false))
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={bulkLoading}
              onClick={() => bulkInputRef.current?.click()}
            >
              {bulkLoading ? t('common.loading') : t('admin.bulkJsonl')}
            </Button>
          </div>
        }
      />

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300">
          {t('admin.demoFiction')}
        </span>
        {t('admin.kbDemoNote', { count: seedSources.length })}
      </div>

      <Card className="mb-6">
        <CardHeader title={t('admin.lexicalSearch')} subtitle={t('admin.lexicalSearchSub')} icon={<Sparkles className="h-5 w-5" />} />
        <div className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              run()
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchPlaceholder')} />
            </div>
            <Button type="submit" disabled={!q.trim() || loading}>{t('common.search')}</Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => run(s)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-teal-50 hover:text-teal-700">{s}</button>
            ))}
          </div>

          {loading && (
            <div className="mt-5 space-y-1 rounded-lg bg-navy-950 p-4 font-mono text-xs text-navy-100">
              <p><span className="text-teal-400">›</span> RAG araması çalışıyor…</p>
              <p className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-teal-400" /> Sonuçlar hazırlanıyor
              </p>
            </div>
          )}
          {hits && (
            <ul className="mt-5 space-y-3">
              {hits.map((h, i) => {
                const pass = h.score >= 0.78
                return (
                  <li key={h.source.id} className={`animate-fade-up rounded-lg border p-4 ${pass ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'}`} style={{ animationDelay: `${i * 70}ms` }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button onClick={() => openSource(h.source.id)} className="text-left text-sm font-semibold text-navy-900 hover:text-teal-700">
                        [{h.source.id}] {kbSourceText(h.source, locale).title}
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full ${pass ? 'bg-teal-500' : 'bg-slate-400'}`} style={{ width: `${h.score * 100}%` }} />
                        </div>
                        <span className={`font-mono text-xs font-semibold ${pass ? 'text-teal-700' : 'text-slate-500'}`}>{h.score.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {kbSourceText(h.source, locale).section}
                      {!pass && ' · retrieval benzerlik eşiği (0.78) altında — klinik güven değil'}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-navy-800">{kbSourceText(h.source, locale).passage}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={t('admin.sources')} icon={<BookOpen className="h-5 w-5" />} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">#</th>
                <th className="th">{t('admin.colSourceName')}</th>
                <th className="th">{t('admin.colType')}</th>
                <th className="th">{t('admin.colLicense')}</th>
                <th className="th text-right">{t('admin.colChunks')}</th>
                <th className="th">{t('admin.colIndexed')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kbSources.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="td font-mono text-xs text-slate-500">{s.id}</td>
                  <td className="td">
                    <button onClick={() => openSource(s.id)} className="text-left font-medium text-navy-900 hover:text-teal-700">
                      {kbSourceText(s, locale).title}
                    </button>
                    {s.id >= 20_000 && s.ragApproved !== true && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-200">
                        {t('admin.notApprovedKb')}
                      </span>
                    )}
                  </td>
                  <td className="td">{kbTypeLabel(s.type, locale)}</td>
                  <td className="td">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.license === 'İzinli' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{kbLicenseLabel(s.license, locale)}</span>
                  </td>
                  <td className="td text-right font-mono">{s.indexing ? t('common.dash') : s.chunks.toLocaleString(intlLocale)}</td>
                  <td className="td">
                    {s.indexing ? <span className="flex items-center gap-1.5 text-teal-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('admin.indexing')}</span> : <span className="text-slate-500">{fmtDate(s.indexedAt)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={t('admin.addSourceModal')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>{t('common.cancel')}</Button>
            <Button disabled={!form.title.trim() || !form.passage.trim() || saving} onClick={() => void add()}>{saving ? t('admin.indexing') : t('admin.addAndIndex')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">{t('admin.sourceName')}</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ör. Nöromüsküler Hastalıklar Notları (örnek)" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('admin.colType')}</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as KbSource['type'] })}>
                <option>Kitap</option>
                <option>Bilimsel yayın</option>
                <option>VRM örnek rapor</option>
              </select>
            </div>
            <div>
              <label className="label">{t('admin.colLicense')}</label>
              <select className="input" value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value as KbSource['license'] })}>
                <option>İzinli</option>
                <option>Beklemede</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">{t('admin.contentPassage')}</label>
            <textarea
              className="input min-h-[120px]"
              value={form.passage}
              onChange={(e) => setForm({ ...form, passage: e.target.value })}
              placeholder="Kaynaktan RAG aramasında kullanılacak metni yapıştırın."
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
