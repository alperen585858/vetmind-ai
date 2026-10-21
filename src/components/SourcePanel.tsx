import { BookOpen, FileText, X } from 'lucide-react'
import { useApp } from '../context/AppContext'

export function SourcePanel() {
  const { sourceId, closeSource, kbSources } = useApp()
  const s = kbSources.find((x) => x.id === sourceId)
  if (!s) return null
  return (
    <div className="fixed inset-0 z-40 no-print">
      <div className="absolute inset-0 bg-navy-950/20" onClick={closeSource} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md animate-slide-in flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
            <BookOpen className="h-4 w-4 text-teal-600" /> Kaynak [{s.id}]
          </div>
          <button onClick={closeSource} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <p className="text-lg font-semibold leading-snug text-navy-900">{s.title}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-navy-50 px-2 py-0.5 font-medium text-navy-700">{s.type}</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${s.license === 'İzinli' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>Lisans: {s.license}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bölüm</p>
            <p className="mt-1 text-sm text-navy-800">{s.section}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">İlgili pasaj</p>
            <blockquote className="mt-2 rounded-lg border-l-4 border-teal-500 bg-teal-50/50 p-4 text-sm leading-relaxed text-navy-900">
              {s.passage}
            </blockquote>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Benzerlik skoru</p>
              <p className="font-semibold text-navy-900">{(0.78 + ((s.id * 7) % 18) / 100).toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Parça (chunk)</p>
              <p className="font-semibold text-navy-900">#{s.id * 37 + 12} / {s.chunks}</p>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Bu pasaj, RAG katmanı tarafından nöroloji bilgi tabanından getirilmiştir. Tüm kaynak içerikleri demo amaçlı örnek metinlerdir.
          </p>
        </div>
      </aside>
    </div>
  )
}
