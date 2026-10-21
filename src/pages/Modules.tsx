import { Brain, Database, FileStack, HeartPulse, Microscope, Bone, Plus, ScanFace } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { MODULES } from '../data/mock'

const ICONS: Record<string, ReactNode> = {
  noroloji: <Brain className="h-6 w-6" />,
  kardiyoloji: <HeartPulse className="h-6 w-6" />,
  onkoloji: <Microscope className="h-6 w-6" />,
  ortopedi: <Bone className="h-6 w-6" />,
  dermatoloji: <ScanFace className="h-6 w-6" />,
}

export default function Modules() {
  const { kbSources, cases, pushToast } = useApp()
  return (
    <>
      <PageHeader
        title="Uzmanlık Modülleri"
        subtitle="Her modül kendi bilgi tabanı, ince ayarlı modeli ve rapor şablonuyla platforma eklenir."
        actions={<Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => pushToast({ tone: 'info', title: 'Yeni modül sihirbazı', body: 'Bu özellik ilerleyen aşamada eklenecek (demo).' })}>Modül ekle</Button>}
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const active = m.status === 'Aktif'
          return (
            <Card key={m.key} className={`flex flex-col p-6 ${active ? 'ring-2 ring-teal-500' : 'bg-slate-50/60'}`}>
              <div className="flex items-start justify-between">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${active ? 'bg-gradient-to-br from-teal-400 to-teal-700 text-white' : 'bg-slate-200 text-slate-400'}`}>{ICONS[m.key]}</div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{m.status}</span>
              </div>
              <p className={`mt-4 text-lg font-semibold ${active ? 'text-navy-900' : 'text-slate-500'}`}>{m.name}</p>
              <p className={`mt-1 text-sm ${active ? 'text-slate-600' : 'text-slate-400'}`}>{m.desc}</p>
              {active ? (
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
                  <div>
                    <dt className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><FileStack className="h-3 w-3" /> Doküman</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-navy-900">{kbSources.length}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><Database className="h-3 w-3" /> Vaka</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-navy-900">{m.cases + cases.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Model</dt>
                    <dd className="mt-1 font-mono text-[11px] font-semibold text-navy-900">{m.model}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-400">Bilgi tabanı ve model hazırlığı planlanıyor.</p>
              )}
            </Card>
          )
        })}
      </div>
      <Card className="mt-6 p-5">
        <p className="text-sm font-semibold text-navy-900">Modüler mimari</p>
        <p className="mt-1 text-sm text-slate-600">
          Ortak katmanlar (veri işleme, RAG, doğrulama, rapor oluşturma, uzman onayı) tüm modüller tarafından paylaşılır. Yeni bir uzmanlık alanı eklemek için yalnızca alan bilgi tabanı, LoRA adaptörü ve rapor şablonu gerekir.
        </p>
      </Card>
    </>
  )
}
