import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { Check, ChevronDown, Menu, RefreshCcw } from 'lucide-react'
import { useApp } from './AppContext'
import { useLocale } from './LocaleContext'
import { DEMO_PASSWORD, demoEmailForRole, setBackendTokens } from '../auth/session'
import { backendLogin, isMfaChallenge } from '../api'
import { USERS } from '../demo/users'
import type { Role } from '../types'
import { LanguageSwitcher } from './LanguageSwitcher'

export const ROLE_BADGE: Record<Role, string> = {
  vet: 'bg-teal-50 text-teal-700 ring-teal-200',
  expert: 'bg-violet-50 text-violet-700 ring-violet-200',
  clinic_owner: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  admin: 'bg-slate-100 text-slate-700 ring-slate-300',
}

export function Topbar({
  onMenu,
  notificationSlot,
}: {
  onMenu: () => void
  notificationSlot?: ReactNode
}) {
  const { role, setRole, user, pushToast, authMode } = useApp()
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const showRoleSwitch = authMode.roleSwitchAllowed

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (!role || !user) return null

  const roleLabel = (r: Role) => t(`roles.${r}`)

  const switchRole = (r: Role) => {
    setOpen(false)
    if (r === role) return
    void (async () => {
      try {
        // Rebind JWT before flipping UI role so Layout refresh / APIs never use the prior token.
        const tokenRes = await backendLogin(demoEmailForRole(r), DEMO_PASSWORD)
        // Demo accounts can never turn on 2FA (#107), so a challenge is not expected here.
        if (!isMfaChallenge(tokenRes)) setBackendTokens(tokenRes)
      } catch {
        /* backend down or auth disabled — UI role still switches; demo headers attribute actors */
      }
      setRole(r)
      nav('/')
      pushToast({ tone: 'info', title: t('topbar.roleChanged', { role: roleLabel(r) }), body: USERS[r].name })
    })()
  }

  return (
    <header className="vm-topbar-glass no-print sticky top-0 z-20 flex h-[4.25rem] items-center gap-3 px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t('topbar.openMenu')}
        className="min-h-11 min-w-11 rounded-md p-2 text-navy-700 hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <LanguageSwitcher persistRemote size="sm" />
        {notificationSlot}

        {showRoleSwitch ? (
          <div className="relative" ref={ref}>
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="listbox"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-dashed border-teal-400 bg-teal-50/60 px-2.5 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">{t('topbar.switchRole')}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            {open && (
              <div
                role="listbox"
                aria-label={t('topbar.roleSelect')}
                className="absolute right-0 mt-2 w-72 animate-fade-up rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {t('topbar.demoRoleSelect')}
                </p>
                <p className="px-3 pb-2 text-[10px] leading-snug text-slate-500">
                  {t('topbar.demoRoleHint')}
                </p>
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
                      <span className="block text-sm font-medium text-navy-900">{roleLabel(r)}</span>
                      <span className="block text-xs text-slate-500">{USERS[r].name}</span>
                    </span>
                    {r === role && <Check className="h-4 w-4 text-teal-600" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-l border-slate-200 pl-3 sm:pl-4">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`} aria-hidden>
            {user.initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-navy-900">{user.name}</p>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`}>{t(`roleTitles.${role}`)}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
