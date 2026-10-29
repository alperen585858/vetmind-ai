import { NavLink, useNavigate } from 'react-router-dom'
import { Activity, BookOpen, ClipboardCheck, FilePlus2, FileText, FolderOpen, Gauge, LayoutDashboard, Layers, LogOut, MessageSquare, PawPrint, ShieldCheck, UploadCloud, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Logo } from './Logo'
import type { Role } from '../types'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badge?: number
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, cases, signOut, pushToast } = useApp()
  const nav = useNavigate()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const ic = 'h-[18px] w-[18px]'
  const roleLabels: Record<NonNullable<typeof role>, string> = {
    vet: 'Veteriner',
    expert: 'Uzman',
    owner: 'Sahip',
    clinic_owner: 'Klinik',
    admin: 'Admin',
  }

  const menus: Record<Role, NavItem[]> = {
    vet: [
      { to: '/', label: 'Kontrol Paneli', icon: <LayoutDashboard className={ic} /> },
      { to: '/basvurular', label: 'Sahip Başvuruları', icon: <ClipboardCheck className={ic} /> },
      { to: '/dicom-yukle', label: 'DICOM Yükle', icon: <UploadCloud className={ic} /> },
      { to: '/vakalar', label: 'Vakalar', icon: <FolderOpen className={ic} /> },
      { to: '/vakalar/yeni', label: 'Yeni Vaka', icon: <FilePlus2 className={ic} /> },
      { to: '/raporlar', label: 'Onaylı Raporlar', icon: <FileText className={ic} /> },
    ],
    expert: [
      { to: '/', label: 'Kontrol Paneli', icon: <LayoutDashboard className={ic} /> },
      { to: '/kuyruk', label: 'İş Listesi', icon: <ClipboardCheck className={ic} />, badge: queue },
      { to: '/vakalar', label: 'Tüm Vakalar', icon: <FolderOpen className={ic} /> },
      { to: '/raporlar', label: 'Onaylı Raporlar', icon: <FileText className={ic} /> },
      { to: '/mesajlar', label: 'İletişim', icon: <MessageSquare className={ic} /> },
    ],
    owner: [
      { to: '/', label: 'Ana Sayfa', icon: <LayoutDashboard className={ic} /> },
      { to: '/hayvanlar', label: 'Pet Profillerim', icon: <PawPrint className={ic} /> },
      { to: '/basvurular', label: 'Görüntüleme Talepleri', icon: <UploadCloud className={ic} /> },
      { to: '/mesajlar', label: 'İletişim', icon: <MessageSquare className={ic} /> },
      { to: '/raporlar', label: 'Raporlarım', icon: <FileText className={ic} /> },
    ],
    clinic_owner: [
      { to: '/', label: 'Klinik Panosu', icon: <LayoutDashboard className={ic} /> },
      { to: '/vakalar', label: 'Klinik Vakalar', icon: <FolderOpen className={ic} /> },
      { to: '/basvurular', label: 'Sahip Başvuruları', icon: <ClipboardCheck className={ic} /> },
    ],
    admin: [
      { to: '/', label: 'Sistem Özeti', icon: <LayoutDashboard className={ic} /> },
      { to: '/mesajlar', label: 'İletişim / Destek', icon: <MessageSquare className={ic} /> },
      { to: '/kullanicilar', label: 'Kullanıcılar / Roller', icon: <ShieldCheck className={ic} /> },
      { to: '/moduller', label: 'Uzmanlık Modülleri', icon: <Layers className={ic} /> },
      { to: '/bilgi-tabani', label: 'Bilgi Tabanı', icon: <BookOpen className={ic} /> },
      { to: '/sistem', label: 'Sistem Durumu', icon: <Activity className={ic} /> },
      { to: '/model-performansi', label: 'Model Performansı', icon: <Gauge className={ic} /> },
    ],
  }
  const items = role ? menus[role] : []

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden no-print" onClick={onClose} />}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-950 text-navy-100 transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-5 pb-6 pt-5">
          <div>
            <Logo dark />
            <p className="mt-1.5 pl-[46px] text-[11px] text-navy-300">VRM Teknoloji iş birliğiyle</p>
            {role && (
              <span className="mt-2 ml-[46px] inline-flex rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-200 ring-1 ring-inset ring-teal-400/30">
                {roleLabels[role]}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="rounded p-1 text-navy-300 hover:bg-navy-800 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Menü</p>
        <nav className="flex-1 space-y-1 px-3" aria-label="Ana menü">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/' || it.to === '/vakalar'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-teal-600/20 text-white ring-1 ring-inset ring-teal-500/40' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                }`
              }
            >
              {it.icon}
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">{it.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => {
            signOut()
            onClose()
            nav('/giris')
            pushToast({ tone: 'info', title: 'Oturum kapatıldı', body: 'Güvenli çıkış yapıldı.' })
          }}
          className="mx-3 mb-3 mt-auto flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 transition hover:bg-vet-red hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-red"
        >
          <LogOut className={ic} aria-hidden="true" />
          <span>Çıkış yap</span>
        </button>
      </aside>
    </>
  )
}
