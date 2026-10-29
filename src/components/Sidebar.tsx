import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FilePlus2,
  FileText,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  Layers,
  LogOut,
  MessageSquare,
  PawPrint,
  Settings,
  ShieldCheck,
  UploadCloud,
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
}

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  open: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const { role, cases, signOut, pushToast } = useApp()
  const nav = useNavigate()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const ic = 'h-[18px] w-[18px] shrink-0'
  const isOwner = role === 'owner'
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
        className={`no-print fixed inset-y-0 left-0 z-40 flex flex-col bg-navy-950 text-navy-100 transition-[width,transform] duration-200 ease-out lg:translate-x-0 ${
          collapsed ? 'lg:w-[72px]' : 'lg:w-64'
        } w-64 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className={`flex items-start gap-2 pb-4 pt-5 ${collapsed ? 'lg:flex-col lg:items-center lg:px-2' : 'justify-between px-5'}`}>
          <div className={collapsed ? 'lg:flex lg:flex-col lg:items-center' : ''}>
            {collapsed ? (
              <div
                className={`hidden h-9 w-9 items-center justify-center rounded-xl shadow-sm lg:flex ${
                  isOwner
                    ? 'bg-gradient-to-br from-sky-300 via-sky-500 to-navy-800'
                    : 'bg-gradient-to-br from-teal-400 to-teal-700'
                }`}
                title="VetMind AI"
              >
                <svg viewBox="0 0 32 32" className="h-3/5 w-3/5" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 17h6l3-7 5 13 3-6h7" />
                </svg>
              </div>
            ) : null}
            <div className={collapsed ? 'lg:hidden' : ''}>
              <Logo dark accent={isOwner ? 'sky' : 'teal'} />
              <p className="mt-1.5 pl-[46px] text-[11px] text-navy-300">VRM Teknoloji iş birliğiyle</p>
              {role && (
                <span
                  className={`mt-2 ml-[46px] inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
                    isOwner
                      ? 'bg-sky-500/15 text-sky-200 ring-sky-400/30'
                      : 'bg-teal-500/15 text-teal-200 ring-teal-400/30'
                  }`}
                >
                  {roleLabels[role]}
                </span>
              )}
            </div>
          </div>
          <div className={`flex items-center gap-1 ${collapsed ? 'lg:mt-2' : ''}`}>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
              className="hidden min-h-9 min-w-9 items-center justify-center rounded-md p-1.5 text-navy-300 hover:bg-navy-800 hover:text-white lg:inline-flex"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronLeft className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Menüyü kapat"
              className="rounded p-1 text-navy-300 hover:bg-navy-800 lg:hidden"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        {!collapsed && (
          <p className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-400 lg:block">Menü</p>
        )}
        <nav className={`flex-1 space-y-1 ${collapsed ? 'lg:px-2' : 'px-3'}`} aria-label="Ana menü">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/' || it.to === '/vakalar'}
              onClick={onClose}
              title={collapsed ? it.label : undefined}
              className={({ isActive }) =>
                `group relative flex items-center rounded-lg text-sm font-medium transition ${
                  collapsed ? 'lg:justify-center lg:px-0 lg:py-2.5' : 'gap-3 px-3 py-2.5'
                } px-3 py-2.5 ${
                  isActive
                    ? isOwner
                      ? 'bg-sky-500/20 text-white ring-1 ring-inset ring-sky-400/40'
                      : 'bg-teal-600/20 text-white ring-1 ring-inset ring-teal-500/40'
                    : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                }`
              }
            >
              {it.icon}
              <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{it.label}</span>
              {!!it.badge && (
                <span
                  className={`rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white ${
                    collapsed ? 'lg:absolute lg:right-1 lg:top-1 lg:px-1.5 lg:py-0 lg:text-[9px]' : ''
                  }`}
                >
                  {it.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className={`mt-auto space-y-1 border-t border-navy-800 pt-2 ${collapsed ? 'lg:px-2' : 'px-3'} px-3 pb-3`}>
          <NavLink
            to="/ayarlar"
            onClick={onClose}
            title={collapsed ? 'Ayarlar' : undefined}
            className={({ isActive }) =>
              `group relative flex min-h-11 items-center rounded-lg text-sm font-medium transition ${
                collapsed ? 'lg:justify-center lg:px-0 lg:py-2.5' : 'gap-3 px-3 py-2.5'
              } gap-3 px-3 py-2.5 ${
                isActive
                  ? isOwner
                    ? 'bg-sky-500/20 text-white ring-1 ring-inset ring-sky-400/40'
                    : 'bg-teal-600/20 text-white ring-1 ring-inset ring-teal-500/40'
                  : 'text-navy-200 hover:bg-navy-800 hover:text-white'
              }`
            }
          >
            <Settings className={ic} aria-hidden="true" />
            <span className={collapsed ? 'lg:hidden' : ''}>Ayarlar</span>
          </NavLink>
          <button
            type="button"
            title="Çıkış yap"
            onClick={() => {
              signOut()
              onClose()
              nav('/giris')
              pushToast({ tone: 'info', title: 'Oturum kapatıldı', body: 'Güvenli çıkış yapıldı.' })
            }}
            className={`flex w-full min-h-11 items-center rounded-lg text-sm font-medium text-navy-200 transition hover:bg-vet-red hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-red ${
              collapsed ? 'lg:justify-center lg:px-0 lg:py-2.5' : 'gap-3 px-3 py-2.5'
            } gap-3 px-3 py-2.5`}
          >
            <LogOut className={ic} aria-hidden="true" />
            <span className={collapsed ? 'lg:hidden' : ''}>Çıkış yap</span>
          </button>
        </div>
      </aside>
    </>
  )
}
