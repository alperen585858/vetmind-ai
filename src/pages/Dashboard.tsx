import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, BookOpen, CheckCircle2, ChevronRight, Clock, Cpu, Database, FilePlus2, FileText, FolderOpen, Hourglass, Layers, Loader2, Microscope, PawPrint, Timer, UploadCloud,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { CaseTable, SpeciesIcon } from '../components/CaseTable'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { CaseProgressTracker } from '../components/CaseProgressTracker'
import { DEPLOYMENTS, GPU_SERIES, MODULES, SERVICES } from '../data/mock'
import { getClinicDashboard } from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { ClinicDashboardStats, VetCase } from '../types'

export default function Dashboard() {
  const { role } = useApp()
  if (role === 'expert') return <ExpertDashboard />
  if (role === 'owner') return <OwnerDashboard />
  if (role === 'admin') return <AdminDashboard />
  return <VetDashboard />
}

function VetDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null)

  useEffect(() => {
    void refreshBackendCases()
    void getClinicDashboard({ q: q || undefined })
      .then(setStats)
      .catch(() => setStats(null))
  }, [refreshBackendCases, q])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return cases.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (!ql) return true
      const hay = `${c.patient.name} ${c.no} ${c.id} ${c.clinic}`.toLowerCase()
      return hay.includes(ql)
    })
  }, [cases, q, statusFilter])

  const open = stats?.active_cases ?? cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).length
  const review = stats?.awaiting_review ?? cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const urgent =
    stats?.urgent_cases ??
    cases.filter((c) => (c.priority === 'STAT' || c.priority === 'Acil') && !['onaylandi', 'reddedildi'].includes(c.status))
      .length
  const approved = stats?.completed_reports ?? cases.filter((c) => c.status === 'onaylandi').length

  return (
    <>
      <PageHeader
        title={`Hoş geldiniz, ${user?.name}`}
        subtitle={`${user?.org} · Klinik vaka panosu`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="lg" icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/dicom-yukle')}>DICOM Yükle</Button>
            <Button size="lg" variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav('/vakalar/yeni')}>Yeni Vaka</Button>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aktif vakalar" value={open} icon={<FolderOpen className="h-5 w-5" />} tone="navy" hint="Sonuçlanmamış" />
        <StatCard label="İnceleme bekleyen" value={review} icon={<Hourglass className="h-5 w-5" />} tone="amber" hint="Uzman kuyruğunda" />
        <StatCard label="Acil / STAT" value={urgent} icon={<Timer className="h-5 w-5" />} tone="violet" hint="Öncelikli iş listesi" />
        <StatCard label="Tamamlanan rapor" value={approved} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" hint="Onaylı teslimat" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Klinik filtre" subtitle="Durum ve arama" />
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
          <label className="label sm:col-span-2" htmlFor="vet-dash-q">
            Ara
            <input
              id="vet-dash-q"
              className="input mt-1"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Hasta, vaka no, klinik…"
            />
          </label>
          <label className="label" htmlFor="vet-dash-status">
            Durum
            <select
              id="vet-dash-status"
              className="input mt-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tümü</option>
              <option value="taslak">Taslak</option>
              <option value="ai_analizi">AI analizi</option>
              <option value="uzman_incelemesinde">Uzman incelemesi</option>
              <option value="onaylandi">Onaylandı</option>
              <option value="revizyon">Revizyon</option>
            </select>
          </label>
        </div>
      </Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Aktif vakalar"
            subtitle={`${filtered.length} kayıt`}
            action={<Link to="/vakalar" className="text-sm font-medium text-teal-700 hover:underline">Tümünü gör</Link>}
          />
          <CaseTable cases={filtered.slice(0, 8)} />
        </Card>
        <Card>
          <CardHeader title="İlerleme özeti" subtitle="Seçili ilk vaka" />
          <div className="px-5 pb-5">
            {filtered[0] ? (
              <CaseProgressTracker status={filtered[0].status} handoffNotes={filtered[0].handoffNotes} />
            ) : (
              <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="Vaka yok" text="Filtreyi temizleyin veya yeni vaka oluşturun." />
            )}
            {stats && stats.unread_messages > 0 && (
              <p className="mt-3 text-xs font-medium text-amber-800">{stats.unread_messages} okunmamış vaka mesajı</p>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}

function waitText(c: VetCase) {
  return c.id.startsWith('c-new') ? 'az önce' : c.priority === 'Acil' ? '3 sa 12 dk' : '1 gün'
}

export function QueueList({ items }: { items: VetCase[] }) {
  const nav = useNavigate()
  if (!items.length) return <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Kuyruk boş" text="Onay bekleyen rapor bulunmuyor." />
  const order = { STAT: 0, Acil: 1, Yüksek: 2, Normal: 3 }
  return (
    <ul className="divide-y divide-slate-100">
      {[...items].sort((a, b) => order[a.priority] - order[b.priority]).map((c) => (
        <li key={c.id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg">
              <SpeciesIcon species={c.patient.species} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-navy-900">{c.patient.name}</p>
                <PriorityBadge priority={c.priority} />
                <span className="font-mono text-xs text-slate-500">{c.no}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-600">
                {c.patient.species} · {c.patient.breed} · {c.patient.age} yaş — {c.ai?.differentials[0]?.name ?? c.clinical.complaint}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {c.clinic} · {c.vetName} · Bekleme: {waitText(c)}
              </p>
            </div>
          </div>
          <Button onClick={() => nav(`/vakalar/${c.id}/calisma`)} icon={<Microscope className="h-4 w-4" />}>
            Çalışma alanı
          </Button>
        </li>
      ))}
    </ul>
  )
}

function ExpertDashboard() {
  const { cases, user } = useApp()
  const nav = useNavigate()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde')
  const approvedCount = cases.filter((c) => c.status === 'onaylandi').length
  const recent = cases.filter((c) => c.status === 'onaylandi' || c.status === 'revizyon' || c.status === 'reddedildi')
  const urgentN = queue.filter((q) => q.priority === 'STAT' || q.priority === 'Acil').length
  return (
    <>
      <PageHeader
        title={`Hoş geldiniz, ${user?.name}`}
        subtitle="Radyolog paneli · iş listesi ve çalışma alanı"
        actions={
          <Button icon={<Microscope className="h-4 w-4" />} onClick={() => nav('/kuyruk')}>
            İş listesine git
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Onay bekleyen" value={queue.length} icon={<Hourglass className="h-5 w-5" />} tone="amber" hint={`${urgentN} STAT/acil`} />
        <StatCard label="STAT / Acil kuyruk" value={urgentN} icon={<Timer className="h-5 w-5" />} tone="violet" hint="Öncelikli inceleme" />
        <StatCard label="Onaylı rapor (oturum)" value={approvedCount} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" hint="Yerel + senkron kayıtlar" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Onay bekleyen raporlar"
            subtitle="Öncelik sırasına göre · çalışma alanından açın"
            icon={<Clock className="h-5 w-5" />}
            action={
              <Link to="/kuyruk" className="text-sm font-medium text-teal-700 hover:underline">
                Tüm iş listesi
              </Link>
            }
          />
          <QueueList items={queue} />
        </Card>
        <Card>
          <CardHeader title="Son kararlarınız" />
          {recent.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 className="h-5 w-5" />} title="Henüz karar yok" text="İş listesinden bir vaka üstlenin." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link to={`/vakalar/${c.id}/calisma`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-medium text-navy-900">{c.patient.name}</p>
                      <p className="text-xs text-slate-500">{c.no}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

const OWNER_TEXT: Record<string, string> = {
  taslak: 'Vaka kaydı hazırlanıyor.',
  isleniyor: 'Tetkik belgeleri işleniyor.',
  ai_analizi: 'Değerlendirme süreci devam ediyor.',
  uzman_incelemesinde: 'Raporunuz uzman veteriner hekim tarafından inceleniyor.',
  revizyon: 'Raporunuz uzman veteriner hekim tarafından inceleniyor.',
  reddedildi: 'Ek değerlendirme gerekiyor; veteriner hekiminiz sizinle iletişime geçecek.',
  onaylandi: 'Raporunuz hazır.',
}

function OwnerDashboard() {
  const { cases, user } = useApp()
  const nav = useNavigate()
  const mine = cases.filter((c) => c.patient.ownerName === user?.name)
  const ready = mine.filter((c) => c.status === 'onaylandi')
  const inProgress = mine.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).length
  return (
    <>
      <PageHeader
        title={`Merhaba, ${user?.name}`}
        subtitle="Hayvanlarınızın vaka durumu ve onaylı raporlar"
        actions={
          ready.length > 0 ? (
            <Button variant="success" onClick={() => nav('/raporlar')} icon={<FileText className="h-4 w-4" />}>
              Raporlarım
            </Button>
          ) : undefined
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Devam eden" value={inProgress} icon={<Clock className="h-5 w-5" />} tone="amber" hint="Klinik sürecinde" />
        <StatCard label="Hazır rapor" value={ready.length} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" hint="Görüntülenebilir" />
      </div>
      {ready.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
          <p className="flex-1 text-sm text-emerald-900">
            <strong>{ready.length} onaylanmış raporunuz hazır.</strong> Raporlar uzman veteriner hekim tarafından incelenip onaylanmıştır.
          </p>
          <Button variant="success" onClick={() => nav('/raporlar')} icon={<FileText className="h-4 w-4" />}>Raporlarım</Button>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {mine.map((c) => {
          const visibleStatus = c.status === 'revizyon' ? 'uzman_incelemesinde' : c.status
          return (
            <Card key={c.id} className="flex flex-col overflow-hidden">
              <div className="flex items-center gap-4 bg-gradient-to-br from-navy-900 to-navy-700 p-5 text-white">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-lg font-semibold" aria-hidden>
                  {c.patient.species === 'Kedi' ? 'K' : 'Kö'}
                </div>
                <div>
                  <p className="text-lg font-semibold">{c.patient.name}</p>
                  <p className="text-sm text-navy-200">
                    {c.patient.species} · {c.patient.breed} · {c.patient.age} yaş
                  </p>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{c.no} · {fmtDate(c.createdAt)}</span>
                  <StatusBadge status={visibleStatus} />
                </div>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-navy-800">Şikâyet:</span> {c.clinical.complaint}
                </p>
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-navy-800">{OWNER_TEXT[c.status]}</p>
                <div className="mt-auto pt-1">
                  {c.status === 'onaylandi' ? (
                    <Button className="w-full" onClick={() => nav(`/raporlar/${c.id}`)} icon={<FileText className="h-4 w-4" />}>Raporu görüntüle</Button>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" /> Rapor onaylandığında bildirim alacaksınız.</p>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        {!mine.length && (
          <Card className="md:col-span-2 xl:col-span-3">
            <EmptyState icon={<PawPrint className="h-6 w-6" />} title="Kayıtlı vaka bulunmuyor" />
          </Card>
        )}
      </div>
    </>
  )
}

export function GpuChart({ height = 180 }: { height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={GPU_SERIES} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gpuFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12a096" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#12a096" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} interval={11} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} unit="%" />
        <Tooltip formatter={(v: number) => [`%${v}`, 'GPU kullanımı']} labelStyle={{ color: '#12233a' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
        <Area type="monotone" dataKey="gpu" stroke="#0b807a" strokeWidth={2} fill="url(#gpuFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function AdminDashboard() {
  const { kbSources, cases } = useApp()
  const nav = useNavigate()
  const chunks = kbSources.reduce((s, k) => s + k.chunks, 0)
  const ok = SERVICES.filter((s) => s.status === 'ok').length
  return (
    <>
      <PageHeader
        title="Sistem Özeti"
        subtitle="Platform durumu · demo izleme verisi (üretim metrikleri değil)"
        actions={
          <Button variant="secondary" onClick={() => nav('/sistem')}>
            Sistem durumu
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aktif modüller" value={`${MODULES.filter((m) => m.status === 'Aktif').length} / ${MODULES.length}`} icon={<Layers className="h-5 w-5" />} tone="teal" hint="Nöroloji aktif" />
        <StatCard label="Bilgi tabanı" value={kbSources.length} icon={<BookOpen className="h-5 w-5" />} tone="navy" hint={`${chunks.toLocaleString('tr-TR')} parça indeksli`} />
        <StatCard label="Oturumdaki vakalar" value={cases.length} icon={<Database className="h-5 w-5" />} tone="violet" hint="Senkron + yerel (şişirilmez)" />
        <StatCard label="Servis sağlığı" value={`${ok}/${SERVICES.length}`} icon={<Activity className="h-5 w-5" />} tone="amber" hint="Mock health paneli" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="GPU kullanımı" subtitle="NVIDIA GPU #0 · son 1 saat" icon={<Cpu className="h-5 w-5" />} action={<Link to="/sistem" className="text-sm font-medium text-teal-700 hover:underline">Sistem Durumu</Link>} />
          <div className="p-4">
            <GpuChart />
          </div>
        </Card>
        <Card>
          <CardHeader title="Son dağıtımlar" />
          <ul className="divide-y divide-slate-100">
            {DEPLOYMENTS.slice(0, 3).map((d) => (
              <li key={d.version} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-navy-900">{d.version}</p>
                  <p className="text-xs text-slate-500">{d.kind} · {fmtDate(d.date)}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
