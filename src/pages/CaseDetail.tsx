import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, BookOpen, Brain, CheckCircle2, ChevronDown, ClipboardList, FileSearch, FileText, Image as ImageIcon, Info, LayoutGrid, Loader2, Microscope, Stethoscope, XCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { PriorityBadge, SeverityBadge, StatusBadge } from '../components/StatusBadge'
import { AIDisclaimer } from '../components/AIDisclaimer'
import { Citations } from '../components/CitationChip'
import { EmptyState } from '../components/EmptyState'
import { localize } from '../lib/localization'
import { fmtDate } from '../lib/format'
import type { ValidationItem, VetCase } from '../types'

const TABS = [
  { key: 'genel', label: 'Genel Bakış', icon: <LayoutGrid className="h-4 w-4" /> },
  { key: 'belgeler', label: 'Belgeler', icon: <FileText className="h-4 w-4" /> },
  { key: 'goruntu', label: 'Görüntüleme', icon: <ImageIcon className="h-4 w-4" /> },
  { key: 'ai', label: 'AI Ön Değerlendirme', icon: <Brain className="h-4 w-4" /> },
]

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { getCase, role } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const tab = params.get('tab') ?? 'genel'

  if (!c) return <Card><EmptyState icon={<FileSearch className="h-6 w-6" />} title="Vaka bulunamadı" action={<Link className="text-sm font-medium text-teal-700" to="/vakalar">Vakalara dön</Link>} /></Card>

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/vakalar" className="hover:underline">Vakalar</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.patient.species === 'Kedi' ? '🐈' : '🐕'} {c.patient.name}
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
          </span>
        }
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed} · ${c.module} · ${fmtDate(c.createdAt)}`}
        actions={
          <>
            {(c.status === 'isleniyor' || (c.status === 'ai_analizi' && c.processingStartedAt)) && (
              <Button variant="secondary" icon={<Loader2 className="h-4 w-4 animate-spin" />} onClick={() => nav(`/vakalar/${c.id}/isleme`)}>İşlem hattını izle</Button>
            )}
            {role === 'expert' && c.status === 'uzman_incelemesinde' && (
              <Button icon={<Microscope className="h-4 w-4" />} onClick={() => nav(`/vakalar/${c.id}/inceleme`)}>İncelemeye başla</Button>
            )}
            {c.status === 'onaylandi' && (
              <Button variant="success" icon={<FileText className="h-4 w-4" />} onClick={() => nav(`/raporlar/${c.id}`)}>Onaylı raporu görüntüle</Button>
            )}
          </>
        }
      />

      {c.status === 'revizyon' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Uzman revizyon talebi:</strong> {c.statusNote}</p>
        </div>
      )}
      {c.status === 'reddedildi' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Ret gerekçesi:</strong> {c.statusNote}</p>
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-navy-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && <Overview c={c} />}
      {tab === 'belgeler' && <Documents c={c} />}
      {tab === 'goruntu' && <Imaging />}
      {tab === 'ai' && <AssessmentView c={c} />}
    </>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-2 text-sm">
      <dt className="col-span-2 text-slate-500">{k}</dt>
      <dd className="col-span-3 text-navy-900">{v}</dd>
    </div>
  )
}

function Overview({ c }: { c: VetCase }) {
  const p = c.patient
  const n = c.neuro
  const loc = localize(n, c.clinical)
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title="Hasta" icon={<ClipboardList className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k="Ad" v={p.name} />
              <Row k="Tür / Irk" v={`${p.species} · ${p.breed}`} />
              <Row k="Cinsiyet" v={`${p.sex}, ${p.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}`} />
              <Row k="Yaş / Kilo" v={`${p.age} yaş · ${p.weight} kg`} />
              <Row k="Sahip" v={`${p.ownerName} · ${p.ownerPhone}`} />
              <Row k="Klinik / Hekim" v={`${c.clinic} · ${c.vetName}`} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Klinik Bilgiler" icon={<Stethoscope className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k="Şikâyet" v={c.clinical.complaint} />
              <Row k="Başlangıç" v={c.clinical.onset} />
              <Row k="Seyir" v={c.clinical.course} />
              <Row k="Klinik geçmiş" v={c.clinical.history || '—'} />
              <Row k="İlaçlar" v={c.clinical.medications || '—'} />
            </dl>
          </Card>
        </div>
        <Card>
          <CardHeader title="Nörolojik Muayene Özeti" icon={<Brain className="h-5 w-5" />} action={loc && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">Olası lokalizasyon: {loc.region}</span>} />
          <div className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
            <dl className="divide-y divide-slate-50">
              <Row k="Bilinç" v={n.consciousness} />
              <Row k="Yürüyüş" v={`${n.gait}${n.limbs.length ? ` — ${n.limbs.join(', ')}` : ''}`} />
              <Row k="Postüral (ön / arka)" v={`${n.posturalThoracic} / ${n.posturalPelvic}`} />
              <Row k="Refleksler (tor. / pel.)" v={`${n.reflexThoracic} / ${n.reflexPelvic}`} />
            </dl>
            <dl className="divide-y divide-slate-50">
              <Row k="Kraniyal sinirler" v={n.cranialNerves.join(', ') || 'Normal'} />
              <Row k="Derin ağrı" v={n.deepPain === 'Değerlendirilmedi' ? <span className="font-medium text-amber-700">Değerlendirilmedi</span> : n.deepPain} />
              <Row k="Spinal hiperestezi" v={n.hyperesthesia} />
            </dl>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Durum Zaman Çizelgesi" />
        <ol className="relative px-5 py-4">
          {c.timeline.map((t, i) => {
            const last = i === c.timeline.length - 1
            return (
              <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
                <span className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 ${last ? 'border-teal-500 bg-teal-100' : 'border-slate-300 bg-white'}`} />
                <div>
                  <p className="text-sm font-medium text-navy-900">{t.label}</p>
                  <p className="text-xs text-slate-500">{fmtDate(t.date)}{t.by ? ` · ${t.by}` : ''}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function Documents({ c }: { c: VetCase }) {
  const [sel, setSel] = useState(c.documents[0]?.id)
  const doc = c.documents.find((d) => d.id === sel)
  if (!c.documents.length) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Henüz belge yüklenmemiş" text="Vaka taslak durumunda." /></Card>
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-3">
        <CardHeader title={`Belgeler (${c.documents.length})`} />
        <ul className="p-2">
          {c.documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => setSel(d.id)} className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${sel === d.id ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : 'hover:bg-slate-50'}`}>
                <FileText className={`mt-0.5 h-5 w-5 shrink-0 ${sel === d.id ? 'text-teal-600' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.pages} sf · {d.size}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> İşlendi</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {doc && (
        <>
          <Card className="lg:col-span-5">
            <CardHeader title="Ham metin" subtitle={`${doc.name} — metne dönüştürülmüş içerik`} />
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-mono text-[12.5px] leading-relaxed text-navy-800">{doc.rawText}</pre>
          </Card>
          <Card className="lg:col-span-4">
            <CardHeader title="Çıkarılmış yapılandırılmış veri" subtitle="Veri İşleme Katmanı çıktısı" />
            <ul className="space-y-3 p-4">
              {doc.extracted.map((e, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{e.field}</p>
                  <p className="mt-0.5 text-sm font-medium text-navy-900">{e.value}</p>
                  <p className="mt-2 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">Kaynak cümle: {e.source}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

function Imaging() {
  const series = ['T2 sagittal', 'T2 transvers', 'T1 post-kontrast']
  const [s, setS] = useState(series[0])
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <span className="mr-2 text-sm font-medium text-navy-800">Seriler:</span>
        {series.map((x) => (
          <button key={x} onClick={() => setS(x)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${s === x ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'}`}>
            {x}
          </button>
        ))}
      </div>
      <div className="p-4">
        <div className="relative flex aspect-[16/9] max-h-[520px] w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 text-center">
          <div className="absolute left-3 top-3 font-mono text-[11px] leading-relaxed text-slate-400">
            <p>Seri: {s}</p>
            <p>Görüntü 12 / 24</p>
          </div>
          <div className="absolute right-3 top-3 font-mono text-[11px] text-slate-400">W: 1200 L: 600</div>
          <ImageIcon className="h-12 w-12 text-slate-500" />
          <p className="mt-3 font-medium text-slate-200">DICOM görüntüleyici (OHIF) — ilerleyen aşamada entegre edilecek</p>
          <p className="mt-1 text-sm text-slate-400">Seçili seri: {s}</p>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Bu sürümde yapay zekâ görüntü analizi yapmaz; değerlendirme yalnızca yüklenen rapor metinleri ve klinik form üzerinden yapılır.
        </p>
      </div>
    </Card>
  )
}

function ValidationBox({ v }: { v: ValidationItem }) {
  const [open, setOpen] = useState(false)
  const meta = {
    ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: 'Kaynakla desteklendi' },
    missing: { cls: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: 'Eksik bilgi' },
    unsupported: { cls: 'border-rose-200 bg-rose-50 text-rose-900', icon: <XCircle className="h-4 w-4 text-rose-600" />, label: 'Kaynakla desteklenmeyen ifade' },
  }[v.kind]
  return (
    <div className={`rounded-lg border ${meta.cls}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5">{meta.icon}</span>
        <span className="flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{meta.label}</span>
          <span className="block text-sm font-medium">{v.text}</span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 opacity-60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-current/10 px-3 pb-3 pl-10 pt-2 text-sm opacity-90">
          {v.detail} <Citations ids={v.citations} />
        </div>
      )}
    </div>
  )
}

export function AssessmentView({ c, compact = false }: { c: VetCase; compact?: boolean }) {
  const ai = c.ai
  if (!ai) {
    return (
      <Card>
        <EmptyState
          icon={c.status === 'taslak' ? <FileText className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          title={c.status === 'taslak' ? 'Henüz AI değerlendirmesi yok' : 'AI analizi sürüyor'}
          text={c.status === 'taslak' ? 'Vaka taslak durumunda; tetkikler yüklenip gönderildiğinde ön değerlendirme oluşturulacak.' : 'Ön değerlendirme hazır olduğunda burada görüntülenecek.'}
        />
      </Card>
    )
  }
  const sources = Array.from(new Set([...ai.differentials.flatMap((d) => d.citations), ...ai.findings.flatMap((f) => f.citations ?? []), ...ai.validation.flatMap((v) => v.citations ?? [])])).sort((a, b) => a - b)
  return (
    <div className="space-y-5">
      <AIDisclaimer />
      <div className={`grid gap-5 ${compact ? '' : 'xl:grid-cols-3'}`}>
        <div className={`space-y-5 ${compact ? '' : 'xl:col-span-2'}`}>
          <Card>
            <CardHeader title="Vaka Özeti" subtitle={`${ai.model} · ${fmtDate(ai.generatedAt)}`} icon={<Brain className="h-5 w-5" />} />
            <p className="p-5 text-[15px] leading-relaxed text-navy-800">{ai.summary}</p>
          </Card>
          <Card>
            <CardHeader title="Dikkat Edilmesi Gereken Bulgular" icon={<AlertCircle className="h-5 w-5" />} />
            <ul className="divide-y divide-slate-100">
              {ai.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <SeverityBadge severity={f.severity} />
                  <p className="flex-1 text-sm text-navy-800">{f.text} <Citations ids={f.citations} /></p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Olası Ayırıcı Tanılar" subtitle="Olasılıklar modelin göreli güvenini gösterir; klinik olasılık değildir." icon={<Stethoscope className="h-5 w-5" />} />
            <div className="divide-y divide-slate-100">
              {ai.differentials.map((d, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-navy-900">{i + 1}. {d.name} <Citations ids={d.citations} /></p>
                    <span className="font-mono text-sm font-semibold text-navy-700">%{d.probability}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${d.probability >= 50 ? 'bg-teal-500' : d.probability >= 20 ? 'bg-sky-400' : 'bg-slate-400'}`} style={{ width: `${d.probability}%` }} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Lehine bulgular</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.pro.length ? d.pro.map((x, j) => <li key={j} className="flex gap-2"><span className="text-emerald-500">+</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">Aleyhine bulgular</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.con.length ? d.con.map((x, j) => <li key={j} className="flex gap-2"><span className="text-rose-500">−</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Önerilen Ek Tetkikler" icon={<ClipboardList className="h-5 w-5" />} />
            <ol className="list-decimal space-y-1.5 py-4 pl-10 pr-5 text-sm text-navy-800">
              {ai.recommendedTests.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Doğrulama Raporu" subtitle="Ayrıntı için kutulara tıklayın" icon={<CheckCircle2 className="h-5 w-5" />} />
            <div className="flex gap-2 px-5 pt-4 text-xs">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{ai.validation.filter((v) => v.kind === 'ok').length} doğrulandı</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{ai.validation.filter((v) => v.kind === 'missing').length} eksik</span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{ai.validation.filter((v) => v.kind === 'unsupported').length} kaynaksız</span>
            </div>
            <div className="space-y-2.5 p-5">
              {ai.validation.map((v, i) => <ValidationBox key={i} v={v} />)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Kaynaklar" subtitle="RAG ile getirilen bilgi tabanı pasajları" icon={<BookOpen className="h-5 w-5" />} />
            <SourceList ids={sources} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function SourceList({ ids }: { ids: number[] }) {
  const { kbSources, openSource } = useApp()
  return (
    <ul className="divide-y divide-slate-100">
      {ids.map((id) => {
        const s = kbSources.find((k) => k.id === id)
        if (!s) return null
        return (
          <li key={id}>
            <button onClick={() => openSource(id)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
              <span className="mt-0.5 rounded bg-teal-50 px-1.5 text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">[{id}]</span>
              <span>
                <span className="block text-sm font-medium text-navy-900">{s.title}</span>
                <span className="block text-xs text-slate-500">{s.type} · {s.section}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
