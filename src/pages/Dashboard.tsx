import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Hourglass,
  Microscope,
  PawPrint,
  UploadCloud,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { CaseTable, SpeciesIcon } from '../components/CaseTable'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { GPU_SERIES } from '../data/mock'
import { getClinicDashboard, getClinicStats, listPets, listSubmissions } from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { BackendClinicStats, BackendPet, BackendImagingSubmission, ClinicDashboardStats, VetCase } from '../types'

export default function Dashboard() {
  const { role } = useApp()
  if (role === 'expert') return <ExpertDashboard />
  if (role === 'owner') return <OwnerDashboard />
  if (role === 'clinic_owner') return <ClinicOwnerDashboard />
  if (role === 'admin') return <AdminDashboard />
  return <VetDashboard />
}

function VetDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const nav = useNavigate()
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null)
  const [pendingSubs, setPendingSubs] = useState(0)

  useEffect(() => {
    void refreshBackendCases()
    void getClinicDashboard().then(setStats).catch(() => setStats(null))
    void listSubmissions()
      .then((rows) =>
        setPendingSubs(rows.filter((s) => s.status === 'pending_verification' || s.status === 'needs_info').length),
      )
      .catch(() => setPendingSubs(0))
  }, [refreshBackendCases])

  const open = stats?.active_cases ?? cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).length
  const review = stats?.awaiting_review ?? cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const active = cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).slice(0, 6)

  return (
    <>
      <PageHeader
        title={`Merhaba, ${user?.name?.split(' ')[0] || 'Veteriner'}`}
        subtitle="Başvuru onayı · vaka kuyruğu · DICOM"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/dicom-yukle')}>
              DICOM yükle
            </Button>
            <Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => nav('/basvurular')}>
              Başvurular{pendingSubs > 0 ? ` (${pendingSubs})` : ''}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Aktif vaka" value={open} icon={<FolderOpen className="h-5 w-5" />} tone="navy" />
        <StatCard label="Onay bekleyen başvuru" value={pendingSubs} icon={<ClipboardCheck className="h-5 w-5" />} tone="amber" />
        <StatCard label="Radyolog kuyruğu" value={review} icon={<Hourglass className="h-5 w-5" />} tone="violet" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Vaka kuyruğu"
          subtitle="Son aktif vakalar"
          action={
            <Link to="/vakalar" className="text-sm font-medium text-teal-700 hover:underline">
              Tümü
            </Link>
          }
        />
        {active.length ? (
          <CaseTable cases={active} />
        ) : (
          <EmptyState
            compact
            icon={<FolderOpen className="h-5 w-5" />}
            title="Aktif vaka yok"
            text="DICOM yükleyin veya sahip başvurusunu doğrulayın."
            action={
              <Button size="sm" onClick={() => nav('/dicom-yukle')}>
                DICOM yükle
              </Button>
            }
          />
        )}
      </Card>
    </>
  )
}

function waitText(c: VetCase) {
  return c.id.startsWith('c-new') ? 'az önce' : c.priority === 'Acil' ? '3 sa' : '1 gün'
}

export function QueueList({ items }: { items: VetCase[] }) {
  const nav = useNavigate()
  if (!items.length) {
    return <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Kuyruk boş" text="İnceleme bekleyen vaka yok." />
  }
  const order = { STAT: 0, Acil: 1, Yüksek: 2, Normal: 3 }
  return (
    <ul className="divide-y divide-slate-100">
      {[...items]
        .sort((a, b) => order[a.priority] - order[b.priority])
        .map((c) => (
          <li key={c.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm">
                <SpeciesIcon species={c.patient.species} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-navy-900">{c.patient.name}</p>
                  <PriorityBadge priority={c.priority} />
                </div>
                <p className="truncate text-sm text-slate-600">
                  {c.modality || '—'} · {c.anatomicalRegion || '—'} · {waitText(c)}
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => nav(`/vakalar/${c.id}/calisma`)} icon={<Microscope className="h-4 w-4" />}>
              İncele
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
  const urgentN = queue.filter((q) => q.priority === 'STAT' || q.priority === 'Acil').length

  return (
    <>
      <PageHeader
        title={`Merhaba, ${user?.name?.split(' ')[0] || 'Radyolog'}`}
        subtitle="İş listesi · DICOM görüntüleyici · rapor"
        actions={
          <Button icon={<Microscope className="h-4 w-4" />} onClick={() => nav('/kuyruk')}>
            İş listesi{queue.length ? ` (${queue.length})` : ''}
          </Button>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <StatCard label="Onay bekleyen" value={queue.length} icon={<Hourglass className="h-5 w-5" />} tone="amber" />
        <StatCard label="STAT / Acil" value={urgentN} icon={<ClipboardCheck className="h-5 w-5" />} tone="violet" />
      </div>
      <Card>
        <CardHeader title="Sıradaki vakalar" subtitle="Öncelik sırasına göre" />
        <QueueList items={queue.slice(0, 8)} />
      </Card>
    </>
  )
}

function OwnerDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const nav = useNavigate()
  const [pets, setPets] = useState<BackendPet[]>([])
  const [subs, setSubs] = useState<BackendImagingSubmission[]>([])

  useEffect(() => {
    void refreshBackendCases()
    void listPets().then(setPets).catch(() => setPets([]))
    void listSubmissions().then(setSubs).catch(() => setSubs([]))
  }, [refreshBackendCases])

  const ready = cases.filter((c) => {
    if (c.status !== 'onaylandi') return false
    if (c.fromBackend) {
      return !c.petOwnerSubject || c.petOwnerSubject === user?.email || c.patient.ownerName === user?.email
    }
    return c.patient.ownerName === user?.name
  })
  const pendingSubs = subs.filter((s) => s.status === 'pending_verification' || s.status === 'needs_info').length
  const linkedSubs = subs.filter((s) => s.status === 'linked').length

  const tiles = [
    {
      title: 'Hayvanlarım',
      text: pets.length ? `${pets.length} kayıtlı pet` : 'Pet profili ekleyin',
      icon: <PawPrint className="h-6 w-6" />,
      to: '/hayvanlar',
      tone: 'bg-sky-50 text-sky-700',
    },
    {
      title: 'DICOM yükle',
      text: 'Görüntüleme talebi gönderin',
      icon: <UploadCloud className="h-6 w-6" />,
      to: '/basvurular',
      tone: 'bg-teal-50 text-teal-700',
      primary: true,
    },
    {
      title: 'Taleplerim',
      text: pendingSubs ? `${pendingSubs} onay bekliyor` : linkedSubs ? `${linkedSubs} vakaya bağlandı` : 'Henüz talep yok',
      icon: <FolderOpen className="h-6 w-6" />,
      to: '/basvurular',
      tone: 'bg-amber-50 text-amber-800',
    },
    {
      title: 'Raporlarım',
      text: ready.length ? `${ready.length} hazır rapor` : 'Onaylı rapor yok',
      icon: <FileText className="h-6 w-6" />,
      to: '/raporlar',
      tone: 'bg-emerald-50 text-emerald-700',
    },
  ]

  return (
    <>
      <PageHeader
        title={`Merhaba, ${user?.name?.split(' ')[0] || 'Sahip'}`}
        subtitle="Hayvanlarınız · DICOM · raporlar"
        actions={
          <Button icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/basvurular')}>
            DICOM yükle
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <button
            key={t.title}
            type="button"
            onClick={() => nav(t.to)}
            className={`flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-teal-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
              t.primary ? 'sm:col-span-2 ring-1 ring-teal-200' : ''
            }`}
          >
            <span className={`rounded-lg p-2.5 ${t.tone}`}>{t.icon}</span>
            <span>
              <span className="block text-base font-semibold text-navy-900">{t.title}</span>
              <span className="mt-0.5 block text-sm text-slate-600">{t.text}</span>
            </span>
          </button>
        ))}
      </div>

      {ready.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Hazır raporlar" action={<Link to="/raporlar" className="text-sm font-medium text-teal-700 hover:underline">Tümü</Link>} />
          <ul className="divide-y divide-slate-100">
            {ready.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link to={`/raporlar/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50">
                  <div>
                    <p className="font-medium text-navy-900">{c.patient.name}</p>
                    <p className="text-xs text-slate-500">{fmtDate(c.createdAt)}</p>
                  </div>
                  <StatusBadge status="onaylandi" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

/** Used by SystemStatus (admin advanced). Kept off the main dashboards. */
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
        <Tooltip
          formatter={(v: number) => [`%${v}`, 'GPU kullanımı']}
          labelStyle={{ color: '#12233a' }}
          contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Area type="monotone" dataKey="gpu" stroke="#0b807a" strokeWidth={2} fill="url(#gpuFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ClinicOwnerDashboard() {
  const { user } = useApp()
  const nav = useNavigate()
  const [stats, setStats] = useState<BackendClinicStats | null>(null)

  useEffect(() => {
    void getClinicStats().then(setStats).catch(() => setStats(null))
  }, [])

  return (
    <>
      <PageHeader
        title="Klinik genel bakış"
        subtitle={user?.org || stats?.clinic_id || 'Klinik'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => nav('/basvurular')}>
              Başvurular
            </Button>
            <Button onClick={() => nav('/vakalar')}>Vakalar</Button>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam vaka" value={stats?.case_count ?? '—'} icon={<FolderOpen className="h-5 w-5" />} tone="navy" />
        <StatCard label="İnceleme bekleyen" value={stats?.awaiting_review ?? '—'} icon={<Hourglass className="h-5 w-5" />} tone="amber" />
        <StatCard label="Onaylı rapor" value={stats?.approved ?? '—'} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Bekleyen başvuru" value={stats?.pending_submissions ?? '—'} icon={<ClipboardCheck className="h-5 w-5" />} tone="violet" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Personel" subtitle={stats?.clinic_id || undefined} icon={<Users className="h-5 w-5" />} />
        {(stats?.staff || []).length ? (
          <ul className="divide-y divide-slate-100">
            {stats!.staff.map((s) => (
              <li key={s.email} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium text-navy-900">{s.display_name || s.email}</span>
                <span className="text-xs text-slate-500">
                  {s.role} · {s.active ? 'aktif' : 'pasif'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={<Users className="h-5 w-5" />} title="Personel listesi yok" text="Auth açıkken klinik personeli burada görünür." />
        )}
      </Card>
    </>
  )
}

function AdminDashboard() {
  const { cases } = useApp()
  const nav = useNavigate()

  return (
    <>
      <PageHeader
        title="Yönetim"
        subtitle="Kullanıcılar ve sistem araçları"
        actions={
          <Button onClick={() => nav('/kullanicilar')} icon={<Users className="h-4 w-4" />}>
            Kullanıcılar
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => nav('/kullanicilar')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <Users className="h-5 w-5 text-teal-700" />
          <p className="mt-3 font-semibold text-navy-900">Kullanıcılar ve roller</p>
          <p className="mt-1 text-sm text-slate-600">Vet, radyolog, sahip, klinik hesabı</p>
        </button>
        <button
          type="button"
          onClick={() => nav('/sistem')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <CheckCircle2 className="h-5 w-5 text-teal-700" />
          <p className="mt-3 font-semibold text-navy-900">Sistem durumu</p>
          <p className="mt-1 text-sm text-slate-600">Servis sağlığı · GPU · dağıtımlar</p>
        </button>
        <button
          type="button"
          onClick={() => nav('/moduller')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <FolderOpen className="h-5 w-5 text-teal-700" />
          <p className="mt-3 font-semibold text-navy-900">Modüller</p>
          <p className="mt-1 text-sm text-slate-600">Uzmanlık modül yapılandırması</p>
        </button>
        <button
          type="button"
          onClick={() => nav('/bilgi-tabani')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <FileText className="h-5 w-5 text-teal-700" />
          <p className="mt-3 font-semibold text-navy-900">Bilgi tabanı</p>
          <p className="mt-1 text-sm text-slate-600">RAG kaynakları (gelişmiş)</p>
        </button>
      </div>
      <p className="mt-4 text-xs text-slate-500">Oturumdaki vaka kaydı: {cases.length}</p>
    </>
  )
}
