import { NavLink } from 'react-router-dom'
import { Activity, BookOpen, ClipboardCheck, FilePlus2, FileText, FolderOpen, LayoutDashboard, Layers, PawPrint, ShieldCheck, UploadCloud, X } from 'lucide-react'
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
  const { role, cases } = useApp()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const ic = 'h-[18px] w-[18px]'

  const menus: Record<Role, NavItem[]> = {
    vet: [
      { to: '/', label: 'Kontrol Paneli', icon: <LayoutDashboard className={ic} /> },
      { to: '/dicom-yukle', label: 'DICOM Yükle', icon: <UploadCloud className={ic} /> },
      { to: '/vakalar', label: 'Vakalar', icon: <FolderOpen className={ic} /> },
      { to: '/vakalar/yeni', label: 'Yeni Vaka', icon: <FilePlus2 className={ic} /> },
      { to: '/raporlar', label: 'Onaylı Raporlar', icon: <FileText className={ic} /> },
    ],
    expert: [
      { to: '/', label: 'Kontrol Paneli', icon: <LayoutDashboard className={ic} /> },
      { to: '/kuyruk', label: 'Onay Kuyruğu', icon: <ClipboardCheck className={ic} />, badge: queue },
      { to: '/vakalar', label: 'Tüm Vakalar', icon: <FolderOpen className={ic} /> },
    ],
    owner: [
      { to: '/', label: 'Hayvanlarım', icon: <PawPrint className={ic} /> },
      { to: '/raporlar', label: 'Raporlarım', icon: <FileText className={ic} /> },
    ],
    admin: [
      { to: '/', label: 'Sistem Özeti', icon: <LayoutDashboard className={ic} /> },
      { to: '/moduller', label: 'Uzmanlık Modülleri', icon: <Layers className={ic} /> },
      { to: '/bilgi-tabani', label: 'Bilgi Tabanı', icon: <BookOpen className={ic} /> },
      { to: '/sistem', label: 'Sistem Durumu', icon: <Activity className={ic} /> },
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
          </div>
          <button onClick={onClose} className="rounded p-1 text-navy-300 hover:bg-navy-800 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Menü</p>
        <nav className="flex-1 space-y-1 px-3">
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
        <div className="m-3 rounded-lg bg-navy-900 p-3 text-xs text-navy-300">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-navy-100">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-400" /> Aktif modül: Nöroloji
          </div>
          Veteriner hekimin yerini almaz; değerlendirme sürecini güçlendirir.
          <p className="mt-2 text-[10px] uppercase tracking-wide text-navy-500">Demo prototip · mock veri</p>
        </div>
      </aside>
    </>
  )
}
