import { NavLink } from 'react-router-dom'
import { useLocalePath, useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
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
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
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
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const lp = useLocalePath()
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const ic = 'h-[18px] w-[18px] shrink-0'
  const isOwner = role === 'owner'
  const roleLabels: Record<NonNullable<typeof role>, string> = {
    vet: t('roles.vetShort'),
    expert: t('roles.expertShort'),
    owner: t('roles.ownerShort'),
    clinic_owner: t('roles.clinicShort'),
    admin: t('roles.adminShort'),
  }

  const menus: Record<Role, NavItem[]> = {
    vet: [
      { to: '/', label: t('nav.dashboard'), icon: <LayoutDashboard className={ic} /> },
      { to: '/basvurular', label: t('nav.ownerSubmissions'), icon: <ClipboardCheck className={ic} /> },
      { to: '/dicom-yukle', label: t('nav.dicomUpload'), icon: <UploadCloud className={ic} /> },
      { to: '/vakalar', label: t('nav.cases'), icon: <FolderOpen className={ic} /> },
      { to: '/vakalar/yeni', label: t('nav.newCase'), icon: <FilePlus2 className={ic} /> },
      { to: '/raporlar', label: t('nav.approvedReports'), icon: <FileText className={ic} /> },
    ],
    expert: [
      { to: '/', label: t('nav.dashboard'), icon: <LayoutDashboard className={ic} /> },
      { to: '/kuyruk', label: t('nav.worklist'), icon: <ClipboardCheck className={ic} />, badge: queue },
      { to: '/ai-tekrar', label: t('nav.aiResend'), icon: <Sparkles className={ic} /> },
      { to: '/vakalar', label: t('nav.allCases'), icon: <FolderOpen className={ic} /> },
      { to: '/raporlar', label: t('nav.approvedReports'), icon: <FileText className={ic} /> },
      { to: '/mesajlar', label: t('nav.messages'), icon: <MessageSquare className={ic} /> },
    ],
    owner: [
      { to: '/', label: t('nav.ownerHome'), icon: <LayoutDashboard className={ic} /> },
      { to: '/hayvanlar', label: t('nav.pets'), icon: <PawPrint className={ic} /> },
      { to: '/basvurular', label: t('nav.imagingRequests'), icon: <UploadCloud className={ic} /> },
      { to: '/mesajlar', label: t('nav.messages'), icon: <MessageSquare className={ic} /> },
      { to: '/raporlar', label: t('nav.myReports'), icon: <FileText className={ic} /> },
    ],
    clinic_owner: [
      { to: '/', label: t('nav.clinicBoard'), icon: <LayoutDashboard className={ic} /> },
      { to: '/vakalar', label: t('nav.clinicCases'), icon: <FolderOpen className={ic} /> },
      { to: '/basvurular', label: t('nav.ownerSubmissions'), icon: <ClipboardCheck className={ic} /> },
    ],
    admin: [
      { to: '/', label: t('nav.systemSummary'), icon: <LayoutDashboard className={ic} /> },
      { to: '/mesajlar', label: t('nav.messagesSupport'), icon: <MessageSquare className={ic} /> },
      { to: '/kullanicilar', label: t('nav.users'), icon: <ShieldCheck className={ic} /> },
      { to: '/moduller', label: t('nav.modules'), icon: <Layers className={ic} /> },
      { to: '/bilgi-tabani', label: t('nav.knowledgeBase'), icon: <BookOpen className={ic} /> },
      { to: '/sistem', label: t('nav.systemStatus'), icon: <Activity className={ic} /> },
      { to: '/model-performansi', label: t('nav.modelPerformance'), icon: <Gauge className={ic} /> },
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
              aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
              aria-expanded={!collapsed}
              title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
              className="hidden min-h-9 min-w-9 items-center justify-center rounded-md p-1.5 text-navy-300 hover:bg-navy-800 hover:text-white lg:inline-flex"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronLeft className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.closeMenu')}
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
              to={lp(it.to)}
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
            to={lp('/ayarlar')}
            onClick={onClose}
            title={collapsed ? t('nav.settings') : undefined}
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
            <span className={collapsed ? 'lg:hidden' : ''}>{t('nav.settings')}</span>
          </NavLink>
          <button
            type="button"
            title={t('nav.logout')}
            onClick={() => {
              signOut()
              onClose()
              nav('/giris')
              pushToast({ tone: 'info', title: t('settings.signOut'), body: t('settings.accountHint') })
            }}
            className={`flex w-full min-h-11 items-center rounded-lg text-sm font-medium text-navy-200 transition hover:bg-vet-red hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-red ${
              collapsed ? 'lg:justify-center lg:px-0 lg:py-2.5' : 'gap-3 px-3 py-2.5'
            } gap-3 px-3 py-2.5`}
          >
            <LogOut className={ic} aria-hidden="true" />
            <span className={collapsed ? 'lg:hidden' : ''}>{t('nav.logout')}</span>
          </button>
        </div>
      </aside>
    </>
  )
}
