import { useState, type FormEvent } from 'react'
import { ArrowRight, Clock, UserPlus } from 'lucide-react'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'
import { Button } from '../components/Button'
import { PasswordStrength, usePasswordError } from '../components/PasswordStrength'
import { backendAccountSession, postLoginPath, setBackendTokens } from '../lib/auth'
import { BackendUnavailableError, backendRegister } from '../lib/backend'

// Self-service roles the backend accepts. Vets start inactive until an admin assigns a clinic.
const ROLES = ['owner', 'vet'] as const
type SignupRole = (typeof ROLES)[number]

const fieldClass = 'input mt-1.5 w-full bg-navy-950 text-white ring-navy-700'

export default function Register() {
  const { signIn, pushToast } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const passwordError = usePasswordError()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState<SignupRole>('owner')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const weak = passwordError(password)
    if (weak) return setError(weak)
    if (password !== confirm) return setError(t('auth.passwordsDontMatch'))
    setBusy(true)
    try {
      const res = await backendRegister({ email, password, role, display_name: name.trim() || undefined })
      if (res.status === 'pending_approval' || !res.session) {
        setPendingEmail(res.email)
        return
      }
      setBackendTokens(res.session)
      const session = backendAccountSession(res.email, res.role, name)
      signIn(session)
      pushToast({ tone: 'success', title: t('auth.registerSuccessTitle'), body: session.email })
      nav(postLoginPath(session.role, locale))
    } catch (err) {
      setError(
        err instanceof BackendUnavailableError
          ? t('auth.backendUnreachable')
          : err instanceof Error
            ? err.message
            : t('auth.loginFailed'),
      )
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

        {pendingEmail ? (
          <div className="mt-10 rounded-2xl border border-navy-800 bg-navy-900/80 p-6 shadow-xl backdrop-blur" role="status">
            <div className="mb-1 flex items-center gap-2 text-amber-300">
              <Clock className="h-5 w-5" />
              <h1 className="text-lg font-semibold text-white">{t('auth.registerPendingTitle')}</h1>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-navy-200">{t('auth.registerPendingBody')}</p>
            <p className="mt-3 font-mono text-xs text-navy-400">{pendingEmail}</p>
            <LocalizedLink
              to="/giris"
              className="mt-5 inline-flex font-semibold text-teal-300 hover:underline"
            >
              {t('auth.backToLogin')}
            </LocalizedLink>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            noValidate
            className="mt-10 rounded-2xl border border-navy-800 bg-navy-900/80 p-6 shadow-xl backdrop-blur"
          >
            <div className="mb-1 flex items-center gap-2 text-teal-300">
              <UserPlus className="h-5 w-5" />
              <h1 className="text-lg font-semibold text-white">{t('auth.registerTitle')}</h1>
            </div>
            <p className="text-sm text-navy-300">{t('auth.registerSubtitle')}</p>

            <label className="mt-5 block text-xs font-medium text-navy-300">
              {t('auth.fullName')}
              <input
                className={fieldClass}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </label>
            <label className="mt-4 block text-xs font-medium text-navy-300">
              {t('auth.email')}
              <input
                className={fieldClass}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="mt-4 block text-xs font-medium text-navy-300">
              {t('auth.password')}
              <input
                className={fieldClass}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <PasswordStrength password={password} dark />
            <label className="mt-4 block text-xs font-medium text-navy-300">
              {t('auth.confirmPassword')}
              <input
                className={fieldClass}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
            <label className="mt-4 block text-xs font-medium text-navy-300">
              {t('auth.role')}
              <select className={fieldClass} value={role} onChange={(e) => setRole(e.target.value as SignupRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 rounded-lg bg-teal-500/10 px-3 py-2 text-xs text-teal-100 ring-1 ring-inset ring-teal-500/30">
              {role === 'vet' ? t('auth.roleHelpVetSignup') : t('auth.roleHelpOwnerSignup')}
            </p>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-500/30">
                {error}
              </p>
            )}

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
        )}
      </div>
    </div>
  )
}
