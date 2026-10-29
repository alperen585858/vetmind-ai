import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, Mail, UserRound } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button } from '../components/Button'
import {
  backendAccountSession,
  login,
  listDemoCredentials,
  postLoginPath,
  setBackendAccessToken,
  setProtectedTokenMode,
  type DemoSession,
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
      let session: DemoSession
      try {
        session = login(email, password)
      } catch (localErr) {
        // Not a browser account: users created on Admin → Kullanıcılar exist only in the backend.
        try {
          const status = await backendAuthStatus()
          setProtectedTokenMode(Boolean(status.auth_enabled || status.deployment_mode === 'protected'))
          const tokenRes = await backendLogin(email, password)
          setBackendAccessToken(tokenRes.access_token)
          session = backendAccountSession(tokenRes.email, tokenRes.role)
        } catch (backendErr) {
          throw backendErr instanceof Error && backendErr.message.includes('rol') ? backendErr : localErr
        }
        signIn(session)
        pushToast({ tone: 'success', title: 'Giriş başarılı', body: `${session.name} · ${ROLE_LABELS[session.role]}` })
        nav(postLoginPath(session.role))
        return
      }
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
    <div className="flex min-h-screen flex-col bg-sky-50 font-display text-navy-900">
      <header className="sticky top-0 z-40 border-b border-sky-100/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="VetMind AI ana sayfa">
            <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 via-sky-500 to-navy-800 shadow-md ring-2 ring-sky-100">
              <span className="text-lg font-bold tracking-tight text-white">V</span>
            </span>
            <span className="leading-tight">
              <span className="block text-[1.35rem] font-bold tracking-tight text-navy-900">VetMind</span>
              <span className="block text-[0.7rem] font-medium uppercase tracking-[0.18em] text-sky-500">
                AI Teleradyoloji
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link
              to="/giris"
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-2 ring-sky-200"
              aria-current="page"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Giriş
            </Link>
            <Link
              to="/kayit"
              className="inline-flex items-center gap-2 rounded-full border border-sky-400 bg-white px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50"
            >
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              Kayıt
            </Link>
          </div>
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-100 via-sky-50 to-white" />
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-sky-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-navy-800/10 blur-3xl" />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-8 lg:py-16">
          <div className="flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">VetMind AI · Bitirme Projesi</p>
            <h1 className="mt-3 max-w-xl text-3xl font-bold leading-tight tracking-tight text-navy-900 sm:text-4xl lg:text-5xl">
              Giriş yapın,
              <span className="text-sky-600"> DICOM metadata yükleyin,</span> uzman onayıyla ilerleyin.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-navy-600">
              Veteriner radyoloji iş akışına güvenli giriş yapın; DICOM yükleme ve uzman onay sürecine devam edin.
            </p>
            <ul className="mt-8 space-y-2 text-sm text-navy-700">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                Rolünüze uygun panoya yönlendirme
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                VRM işbirliğiyle klinik odaklı prototip
              </li>
            </ul>
          </div>

          <div className="w-full max-w-md shrink-0">
            <form
              onSubmit={onSubmit}
              className="rounded-2xl border border-sky-100 bg-white p-6 shadow-[0_12px_40px_rgba(14,165,233,0.12)] sm:p-7"
            >
              <h2 className="text-lg font-semibold text-navy-900">Hesaba giriş</h2>
              <p className="mt-1 text-sm text-navy-500">Kayıtlı e-posta ve şifrenizle devam edin.</p>

              <label className="mt-5 block text-xs font-medium text-navy-700">
                E-posta
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-500" />
                  <input
                    className="input w-full border-sky-100 bg-sky-50/50 pl-10 focus:border-sky-500 focus:ring-sky-500/20"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vet@demo.local"
                    required
                  />
                </div>
              </label>

              <label className="mt-4 block text-xs font-medium text-navy-700">
                Şifre
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-500" />
                  <input
                    className="input w-full border-sky-100 bg-sky-50/50 pl-10 focus:border-sky-500 focus:ring-sky-500/20"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </label>

              {error && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="mt-5 w-full !bg-sky-500 hover:!bg-sky-600 focus-visible:!outline-sky-500"
                size="lg"
                disabled={busy}
                icon={<ArrowRight className="h-4 w-4" />}
              >
                {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
              </Button>

              <p className="mt-4 text-center text-sm text-navy-600">
                Hesabınız yok mu?{' '}
                <Link to="/kayit" className="font-semibold text-sky-600 hover:underline">
                  Kayıt olun
                </Link>
              </p>
            </form>

            <div className="mt-4 rounded-xl border border-sky-100 bg-white/80 p-4 text-xs text-navy-600">
              <p className="font-semibold text-navy-800">Örnek hesaplar</p>
              <ul className="mt-2 space-y-1">
                {listDemoCredentials().map((c) => (
                  <li key={c.email}>
                    <button
                      type="button"
                      className="text-left transition hover:text-sky-700"
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
        </div>
      </main>

      <footer className="border-t border-sky-100 bg-navy-950 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <p className="text-sm text-sky-200/80">
            © {new Date().getFullYear()} VetMind AI · Acıbadem Üniversitesi CSE 401/402 · VRM Teknoloji iş birliğiyle
          </p>
          <div className="flex gap-4 text-sm text-sky-300/90">
            <Link to="/" className="hover:text-white">
              Ana sayfa
            </Link>
            <Link to="/kayit" className="hover:text-white">
              Kayıt
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
