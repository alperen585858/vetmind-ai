import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, ChevronDown, LogOut, Menu, RefreshCcw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { ROLE_LABELS, USERS } from '../data/mock'
import type { Role } from '../types'

export const ROLE_BADGE: Record<Role, string> = {
  vet: 'bg-teal-50 text-teal-700 ring-teal-200',
  expert: 'bg-violet-50 text-violet-700 ring-violet-200',
  owner: 'bg-sky-50 text-sky-700 ring-sky-200',
  admin: 'bg-slate-100 text-slate-700 ring-slate-300',
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { role, setRole, user, cases, pushToast } = useApp()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (!role || !user) return null
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde').length

  const switchRole = (r: Role) => {
    setOpen(false)
    if (r === role) return
    setRole(r)
    nav('/')
    pushToast({ tone: 'info', title: `Rol değiştirildi: ${ROLE_LABELS[r]}`, body: USERS[r].name })
  }

  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-md p-2 text-navy-700 hover:bg-slate-100 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <div className="hidden text-sm text-slate-500 md:block">
        Modül: <span className="font-medium text-navy-800">Veteriner Nöroloji</span>
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <button className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Bildirimler">
          <Bell className="h-5 w-5" />
          {role === 'expert' && queue > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />}
        </button>

        <div className="relative" ref={ref}>
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-dashed border-teal-400 bg-teal-50/60 px-2.5 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-50">
            <RefreshCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Rol değiştir</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-72 animate-fade-up rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Demo: rol seçin</p>
              {(Object.keys(USERS) as Role[]).map((r) => (
                <button key={r} onClick={() => switchRole(r)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${r === role ? 'bg-slate-50' : ''}`}>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ${ROLE_BADGE[r]}`}>{USERS[r].initials}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-navy-900">{ROLE_LABELS[r]}</span>
                    <span className="block text-xs text-slate-500">{USERS[r].name}</span>
                  </span>
                  {r === role && <Check className="h-4 w-4 text-teal-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-3 sm:pl-4">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`}>{user.initials}</span>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-navy-900">{user.name}</p>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`}>{user.title}</span>
          </div>
          <button
            onClick={() => {
              setRole(null)
              nav('/')
            }}
            title="Çıkış"
            className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
