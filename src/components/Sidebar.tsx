import { NavLink } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  ClipboardCheck,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Layers,
  PawPrint,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Logo } from './Logo'
import type { Role } from '../types'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badge?: number
  end?: boolean
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, cases } = useApp()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const ic = 'h-[18px] w-[18px]'

  const menus: Record<Role, NavGroup[]> = {
    owner: [
      {
        items: [
          { to: '/', label: 'Ana sayfa', icon: <LayoutDashboard className={ic} />, end: true },
          { to: '/hayvanlar', label: 'Hayvanlarım', icon: <PawPrint className={ic} /> },
          { to: '/basvurular', label: 'DICOM yükle', icon: <UploadCloud className={ic} /> },
          { to: '/raporlar', label: 'Raporlarım', icon: <FileText className={ic} /> },
        ],
      },
    ],
    vet: [
      {
        label: 'İş akışı',
        items: [
          { to: '/', label: 'Ana sayfa', icon: <LayoutDashboard className={ic} />, end: true },
          { to: '/basvurular', label: 'Başvuru onayı', icon: <ClipboardCheck className={ic} /> },
          { to: '/vakalar', label: 'Vaka kuyruğu', icon: <FolderOpen className={ic} />, end: true },
          { to: '/dicom-yukle', label: 'DICOM yükle', icon: <UploadCloud className={ic} /> },
        ],
      },
      {
        label: 'Sonuçlar',
        items: [{ to: '/raporlar', label: 'Onaylı raporlar', icon: <FileText className={ic} /> }],
      },
    ],
    expert: [
      {
        items: [
          { to: '/', label: 'Ana sayfa', icon: <LayoutDashboard className={ic} />, end: true },
          { to: '/kuyruk', label: 'İş listesi', icon: <ClipboardCheck className={ic} />, badge: queue },
        ],
      },
    ],
    clinic_owner: [
      {
        label: 'Klinik',
        items: [
          { to: '/', label: 'Genel bakış', icon: <LayoutDashboard className={ic} />, end: true },
          { to: '/vakalar', label: 'Vakalar', icon: <FolderOpen className={ic} />, end: true },
          { to: '/basvurular', label: 'Başvurular', icon: <ClipboardCheck className={ic} /> },
          { to: '/raporlar', label: 'Raporlar', icon: <FileText className={ic} /> },
        ],
      },
    ],
    admin: [
      {
        label: 'Yönetim',
        items: [
          { to: '/', label: 'Genel bakış', icon: <LayoutDashboard className={ic} />, end: true },
          { to: '/kullanicilar', label: 'Kullanıcılar', icon: <Users className={ic} /> },
        ],
      },
      {
        label: 'Gelişmiş',
        items: [
          { to: '/moduller', label: 'Modüller', icon: <Layers className={ic} /> },
          { to: '/bilgi-tabani', label: 'Bilgi tabanı', icon: <BookOpen className={ic} /> },
          { to: '/sistem', label: 'Sistem durumu', icon: <Activity className={ic} /> },
        ],
      },
    ],
  }

  const groups = role ? menus[role] : []

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden no-print" onClick={onClose} />}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy-950 text-navy-100 transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-4 pb-4 pt-5">
          <Logo dark />
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="rounded p-1 text-navy-300 hover:bg-navy-800 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4" aria-label="Ana menü">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label ? (
                <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end ?? it.to === '/'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                      }`
                    }
                  >
                    {it.icon}
                    <span className="flex-1">{it.label}</span>
                    {!!it.badge && (
                      <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                        {it.badge}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-navy-800 px-4 py-3 text-[11px] text-navy-500">
          <div className="flex items-center gap-1.5 text-navy-300">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-500" aria-hidden />
            Nöroloji · karar destek
          </div>
        </div>
      </aside>
    </>
  )
}
