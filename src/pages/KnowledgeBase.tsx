import { useEffect, useState } from 'react'
import { BookOpen, Loader2, Plus, Search, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { BackendUnavailableError, addRagDocument, listCustomRagDocuments, searchRag, type RagCustomDocument } from '../lib/backend'
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
  }
}

export default function KnowledgeBase() {
  const { kbSources: seedSources, pushToast, openSource } = useApp()
  const [custom, setCustom] = useState<KbSource[]>([])
  const [saving, setSaving] = useState(false)
  const kbSources = [...custom, ...seedSources]

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
      pushToast({ tone: 'success', title: 'Kaynak eklendi ve indekslendi', body: 'Artık RAG aramasında ve rapor taslaklarında kullanılabilir.' })
    } catch (err) {
      pushToast({ tone: 'error', title: 'Kaynak eklenemedi', body: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Bilgi Tabanı — Nöroloji"
        subtitle={`${kbSources.length} kaynak · lexical RAG arama`}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal(true)}>Kaynak Ekle</Button>}
      />

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300">
          DEMO FICTION
        </span>
        Soldaki seed corpus ({seedSources.length} kaynak) frontend mock’tur. Backend RAG / özel dokümanlar ayrıdır;
        arama önce API’ye gider, başarısızsa yerel lexical skora düşer — klinik onaylı KB değildir.
      </div>

      <Card className="mb-6">
        <CardHeader title="Lexical RAG arama" subtitle="Backend RAG + seed mock ayrımı" icon={<Sparkles className="h-5 w-5" />} />
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
              <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ör. kondrodistrofik ırkta akut parezi" />
            </div>
            <Button type="submit" disabled={!q.trim() || loading}>Ara</Button>
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
                        [{h.source.id}] {h.source.title}
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full ${pass ? 'bg-teal-500' : 'bg-slate-400'}`} style={{ width: `${h.score * 100}%` }} />
                        </div>
                        <span className={`font-mono text-xs font-semibold ${pass ? 'text-teal-700' : 'text-slate-500'}`}>{h.score.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {h.source.section}
                      {!pass && ' · retrieval benzerlik eşiği (0.78) altında — klinik güven değil'}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-navy-800">{h.source.passage}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Kaynaklar" icon={<BookOpen className="h-5 w-5" />} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">#</th>
                <th className="th">Kaynak adı</th>
                <th className="th">Tür</th>
                <th className="th">Lisans durumu</th>
                <th className="th text-right">Parça (chunk)</th>
                <th className="th">İndekslenme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kbSources.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="td font-mono text-xs text-slate-500">{s.id}</td>
                  <td className="td">
                    <button onClick={() => openSource(s.id)} className="text-left font-medium text-navy-900 hover:text-teal-700">{s.title}</button>
                  </td>
                  <td className="td">{s.type}</td>
                  <td className="td">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.license === 'İzinli' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{s.license}</span>
                  </td>
                  <td className="td text-right font-mono">{s.indexing ? '—' : s.chunks.toLocaleString('tr-TR')}</td>
                  <td className="td">
                    {s.indexing ? <span className="flex items-center gap-1.5 text-teal-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> İndeksleniyor…</span> : <span className="text-slate-500">{fmtDate(s.indexedAt)}</span>}
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
        title="Kaynak ekle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>Vazgeç</Button>
            <Button disabled={!form.title.trim() || !form.passage.trim() || saving} onClick={() => void add()}>{saving ? 'İndeksleniyor…' : 'Ekle ve indeksle'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Kaynak adı</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ör. Nöromüsküler Hastalıklar Notları (örnek)" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tür</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as KbSource['type'] })}>
                <option>Kitap</option>
                <option>Bilimsel yayın</option>
                <option>VRM örnek rapor</option>
              </select>
            </div>
            <div>
              <label className="label">Lisans durumu</label>
              <select className="input" value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value as KbSource['license'] })}>
                <option>İzinli</option>
                <option>Beklemede</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">İçerik (pasaj)</label>
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
