import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Logo } from '../components/Logo'
import { Button } from '../components/Button'
import {
  login,
  listDemoCredentials,
  postLoginPath,
  setBackendAccessToken,
  setProtectedTokenMode,
} from '../lib/auth'
import { backendAuthStatus, backendLogin } from '../lib/backend'
import { ROLE_LABELS } from '../data/mock'

export default function Login() {
  const { signIn, pushToast } = useApp()
  const nav = useNavigate()
  const [email, setEmail] = useState('vet@demo.local')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const session = login(email, password)
      try {
        const status = await backendAuthStatus()
        setProtectedTokenMode(Boolean(status.auth_enabled || status.deployment_mode === 'protected'))
        const tokenRes = await backendLogin(email, password)
        setBackendAccessToken(tokenRes.access_token)
      } catch {
        setBackendAccessToken(null)
      }
      signIn(session)
      pushToast({ tone: 'success', title: 'Giriş başarılı', body: `${session.name} · ${ROLE_LABELS[session.role]}` })
      nav(postLoginPath(session.role))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-teal-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[420px] w-[420px] rounded-full bg-navy-600/40 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 lg:flex-row lg:items-center lg:gap-16">
        <div className="flex-1">
          <Link to="/" className="inline-block transition opacity-90 hover:opacity-100">
            <Logo dark size="lg" />
          </Link>
          <p className="mt-10 text-sm font-semibold uppercase tracking-wider text-teal-400">VetMind AI · Bitirme Projesi</p>
          <h1 className="mt-3 max-w-xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Giriş yapın,
            <span className="text-teal-300"> DICOM metadata yükleyin,</span> uzman onayıyla ilerleyin.
          </h1>
          <p className="mt-5 max-w-lg text-base text-navy-200">
            Demo UI oturumu localStorage’dadır. Backend açıksa JWT de alınır (VETMIND_AUTH_ENABLED=1 iken API koruması aktif). AI çıktıları klinik tanı değildir.
          </p>
        </div>

        <div className="mt-12 w-full max-w-md lg:mt-0">
          <form onSubmit={onSubmit} className="rounded-2xl border border-navy-800 bg-navy-900/80 p-6 shadow-xl backdrop-blur">
            <h2 className="text-lg font-semibold text-white">Hesaba giriş</h2>
            <p className="mt-1 text-sm text-navy-300">Kayıtlı e-posta ve şifrenizle devam edin.</p>

            <label className="mt-5 block text-xs font-medium text-navy-300">
              E-posta
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
                <input
                  className="input w-full bg-navy-950 pl-10 text-white ring-navy-700 placeholder:text-navy-500"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vet@demo.local"
                  required
                />
              </div>
            </label>

            <label className="mt-4 block text-xs font-medium text-navy-300">
              Şifre
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
                <input
                  className="input w-full bg-navy-950 pl-10 text-white ring-navy-700 placeholder:text-navy-500"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </label>

            {error && <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-500/30">{error}</p>}

            <Button type="submit" className="mt-5 w-full" size="lg" disabled={busy} icon={<ArrowRight className="h-4 w-4" />}>
              {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
            </Button>

            <p className="mt-4 text-center text-sm text-navy-300">
              Hesabınız yok mu?{' '}
              <Link to="/kayit" className="font-semibold text-teal-300 hover:underline">
                Kayıt olun
              </Link>
            </p>
          </form>

          <div className="mt-4 rounded-xl border border-navy-800 bg-navy-900/50 p-4 text-xs text-navy-300">
            <p className="font-semibold text-navy-100">Demo hesaplar (şifre: demo1234)</p>
            <ul className="mt-2 space-y-1">
              {listDemoCredentials().map((c) => (
                <li key={c.email}>
                  <button
                    type="button"
                    className="text-left hover:text-teal-300"
                    onClick={() => {
                      setEmail(c.email)
                      setPassword(c.password)
                    }}
                  >
                    {c.email} · {ROLE_LABELS[c.role]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-auto pt-10 text-xs text-navy-400 lg:absolute lg:bottom-10 lg:left-6">
          Acıbadem Üniversitesi CSE 401/402 · VRM Teknoloji iş birliğiyle · Demo prototip
        </div>
      </div>
    </div>
  )
}
