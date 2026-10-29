import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, Menu, RefreshCcw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { DEMO_PASSWORD, demoEmailForRole, setBackendAccessToken } from '../lib/auth'
import { backendLogin } from '../lib/backend'
import { ROLE_LABELS, USERS } from '../data/mock'
import type { Role } from '../types'
import { NotificationBell } from './NotificationBell'

export const ROLE_BADGE: Record<Role, string> = {
  vet: 'bg-teal-50 text-teal-700 ring-teal-200',
  expert: 'bg-violet-50 text-violet-700 ring-violet-200',
  owner: 'bg-sky-50 text-sky-700 ring-sky-200',
  clinic_owner: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  admin: 'bg-slate-100 text-slate-700 ring-slate-300',
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { role, setRole, user, pushToast } = useApp()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (!role || !user) return null

  const switchRole = (r: Role) => {
    setOpen(false)
    if (r === role) return
    setRole(r)
    void (async () => {
      try {
        // Await JWT rebind so subsequent API calls (e.g. mesajlar) use the new role.
        const tokenRes = await backendLogin(demoEmailForRole(r), DEMO_PASSWORD)
        setBackendAccessToken(tokenRes.access_token)
      } catch {
        /* backend down or auth disabled — UI role still switches; demo headers attribute actors */
      }
      nav('/')
      pushToast({ tone: 'info', title: `Rol değiştirildi: ${ROLE_LABELS[r]}`, body: USERS[r].name })
    })()
  }

  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-surface-elevated/90 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Menüyü aç"
        className="min-h-11 min-w-11 rounded-md p-2 text-navy-700 hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <NotificationBell />

        <div className="relative" ref={ref}>
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-dashed border-teal-400 bg-teal-50/60 px-2.5 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Rol değiştir</span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
          {open && (
            <div
              role="listbox"
              aria-label="Rol seçimi"
              className="absolute right-0 mt-2 w-72 animate-fade-up rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rol seçin</p>
              {(Object.keys(USERS) as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="option"
                  aria-selected={r === role}
                  onClick={() => switchRole(r)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${r === role ? 'bg-slate-50' : ''}`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ${ROLE_BADGE[r]}`}>{USERS[r].initials}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-navy-900">{ROLE_LABELS[r]}</span>
                    <span className="block text-xs text-slate-500">{USERS[r].name}</span>
                  </span>
                  {r === role && <Check className="h-4 w-4 text-teal-600" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-3 sm:pl-4">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`} aria-hidden>
            {user.initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-navy-900">{user.name}</p>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`}>{user.title}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
