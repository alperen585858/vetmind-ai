import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, CheckCircle2, Clock, Download, FileText, Phone } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Logo } from '../components/Logo'
import { SECTION_LABELS } from '../data/mock'
import { fmtDate } from '../lib/format'
import type { SectionKey } from '../types'

const KEYS = Object.keys(SECTION_LABELS) as SectionKey[]

export default function ApprovedReport() {
  const { id = '' } = useParams()
  const { getCase, role, user } = useApp()
  const nav = useNavigate()
  const c = getCase(id)

  const forbidden = !c || (role === 'owner' && c.patient.ownerName !== user?.name)
  if (forbidden) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Rapor bulunamadı" /></Card>
  if (c.status !== 'onaylandi' || !c.report) {
    return (
      <Card>
        <EmptyState icon={<Clock className="h-6 w-6" />} title="Rapor henüz onaylanmadı" text="Rapor uzman veteriner hekim tarafından onaylandığında burada görüntülenecek." action={<Link to="/" className="text-sm font-medium text-teal-700">Ana sayfaya dön</Link>} />
      </Card>
    )
  }
  const p = c.patient
  const r = c.report

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav(-1)}>Geri</Button>
        {import.meta.env.MODE !== 'share' && <Button icon={<Download className="h-4 w-4" />} onClick={() => window.print()}>PDF olarak indir</Button>}
      </div>

      {role === 'owner' && (
        <div className="no-print mb-6 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            <h2 className="text-xl font-semibold text-navy-900">Raporunuz hazır</h2>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-navy-800">
            <strong>{p.name}</strong> için hazırlanan nöroloji değerlendirme raporu, uzman veteriner hekim <strong>{c.approvedBy}</strong> tarafından {fmtDate(c.approvedAt)} tarihinde incelenip onaylanmıştır.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Raporda yer alan tıbbi terimler ve tedavi seçenekleri hakkında en doğru bilgiyi veteriner hekiminiz <strong>{c.vetName}</strong> verecektir.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Phone className="h-4 w-4" /> {c.clinic}</p>
        </div>
      )}

      <article className="rounded-xl border border-slate-200 bg-white shadow-soft print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b-4 border-teal-600 px-8 py-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-1 pl-[46px] text-[11px] text-slate-500">VRM Teknoloji iş birliğiyle</p>
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-lg font-semibold text-navy-900">Veteriner Nöroloji Değerlendirme Raporu</p>
            <p className="text-slate-500">Rapor No: <span className="font-mono font-medium text-navy-800">{c.reportNo}</span></p>
            <p className="text-slate-500">Vaka No: <span className="font-mono">{c.no}</span></p>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-100 px-8 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hasta bilgileri</p>
            <dl className="space-y-1">
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Ad</dt><dd className="font-medium text-navy-900">{p.name}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Tür / Irk</dt><dd className="text-navy-900">{p.species} · {p.breed}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Cinsiyet</dt><dd className="text-navy-900">{p.sex}, {p.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Yaş / Kilo</dt><dd className="text-navy-900">{p.age} yaş · {p.weight} kg</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Sahip</dt><dd className="text-navy-900">{p.ownerName}</dd></div>
            </dl>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Klinik bilgiler</p>
            <dl className="space-y-1">
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Klinik</dt><dd className="text-navy-900">{c.clinic}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Sevk eden</dt><dd className="text-navy-900">{c.vetName}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Başvuru</dt><dd className="text-navy-900">{fmtDate(c.createdAt)}</dd></div>
              <div className="flex gap-2"><dt className="w-28 text-slate-500">Modül</dt><dd className="text-navy-900">{c.module}</dd></div>
            </dl>
          </div>
        </section>

        <section className="space-y-6 px-8 py-6">
          {KEYS.map((k) => (
            <div key={k}>
              <h3 className="mb-2 border-b border-slate-100 pb-1 text-sm font-semibold uppercase tracking-wide text-teal-700">{SECTION_LABELS[k]}</h3>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-navy-900">{r[k]}</p>
            </div>
          ))}
        </section>

        <footer className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50/70 px-8 py-5 sm:flex-row sm:items-end sm:justify-between print:bg-white">
          <div className="flex items-start gap-3">
            <BadgeCheck className="h-8 w-8 text-emerald-600" />
            <div className="text-sm">
              <p className="text-slate-500">Onaylayan uzman</p>
              <p className="font-semibold text-navy-900">{c.approvedBy}</p>
              <p className="text-slate-500">Uzman Veteriner Nörolog · VRM Teknoloji</p>
            </div>
          </div>
          <div className="text-sm sm:text-right">
            <p className="text-slate-500">Onay tarihi</p>
            <p className="font-semibold text-navy-900">{fmtDate(c.approvedAt)}</p>
          </div>
        </footer>
        <p className="px-8 py-4 text-[11px] leading-relaxed text-slate-400">
          Bu rapor yapay zekâ destekli ön değerlendirme temel alınarak hazırlanmış ve uzman veteriner hekim tarafından incelenip onaylanmıştır. Demo prototip çıktısıdır; gerçek hasta verisi içermez.
        </p>
      </article>
    </div>
  )
}
