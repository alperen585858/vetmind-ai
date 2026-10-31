import { useState, type FormEvent } from 'react'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { ArrowRight, UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'
import { Button } from '../components/Button'
import { postLoginPath, register, setBackendAccessToken } from '../lib/auth'
import { backendLogin } from '../lib/backend'
import type { Role } from '../types'

// Admin accounts are not self-service; they come from the seed list or Admin → Kullanıcılar.
const ROLES: Role[] = ['vet', 'expert', 'owner', 'clinic_owner']

export default function Register() {
  const { signIn, pushToast } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('vet')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const session = register({ name, email, password, role })
      try {
        const tokenRes = await backendLogin(email, password)
        setBackendAccessToken(tokenRes.access_token)
      } catch {
        // Seed demo emails match backend; custom emails may only get UI session.
        setBackendAccessToken(null)
      }
      signIn(session)
      pushToast({
        tone: 'success',
        title: t('common.success'),
        body:
          role === 'vet'
            ? t('auth.roleHelpVet')
            : `${t(`roles.${role}`)} — ${t('auth.registerSubtitle')}`,
      })
      nav(postLoginPath(session.role, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div className="pointer-events-none absolute -right-32 top-10 h-[420px] w-[420px] rounded-full bg-teal-600/20 blur-3xl" />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <Logo dark size="lg" />
          <LanguageSwitcher persistRemote={false} size="sm" />
        </div>
        <form onSubmit={onSubmit} className="mt-10 rounded-2xl border border-navy-800 bg-navy-900/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-1 flex items-center gap-2 text-teal-300">
            <UserPlus className="h-5 w-5" />
            <h1 className="text-lg font-semibold text-white">{t('auth.registerTitle')}</h1>
          </div>
          <p className="text-sm text-navy-300">{t('auth.registerSubtitle')}</p>
          <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-xs leading-relaxed text-amber-100 ring-1 ring-inset ring-amber-500/30">
            Bu kayıt yalnızca tarayıcıda (demo hesap) saklanır. Backend API dizini için Admin → Kullanıcılar
            üzerinden kullanıcı oluşturun; aksi halde özel e-postalar JWT / RBAC ile eşleşmeyebilir.
          </p>

          <label className="mt-5 block text-xs font-medium text-navy-300">
            {t('auth.fullName')}
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            {t('auth.email')}
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            {t('auth.password')} (min. 6)
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            {t('auth.role')}
            <select className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </label>

          {role === 'vet' && (
            <p className="mt-3 rounded-lg bg-teal-500/10 px-3 py-2 text-xs text-teal-100 ring-1 ring-inset ring-teal-500/30">
              {t('auth.roleHelpVet')}
            </p>
          )}

          {error && <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-500/30">{error}</p>}

          <Button type="submit" className="mt-5 w-full" size="lg" disabled={busy} icon={<ArrowRight className="h-4 w-4" />}>
            {busy ? t('common.loading') : t('auth.submitRegister')}
          </Button>

          <p className="mt-4 text-center text-sm text-navy-300">
            {t('auth.haveAccount')}{' '}
            <LocalizedLink to="/giris" className="font-semibold text-teal-300 hover:underline">
              {t('auth.goLogin')}
            </LocalizedLink>
          </p>
        </form>
      </div>
    </div>
  )
}
