import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Logo } from '../components/Logo'
import { Button } from '../components/Button'
import { postLoginPath, register, setBackendAccessToken } from '../lib/auth'
import { backendLogin } from '../lib/backend'
import { ROLE_LABELS } from '../data/mock'
import type { Role } from '../types'

const ROLES: Role[] = ['vet', 'expert', 'owner', 'clinic_owner', 'admin']

export default function Register() {
  const { signIn, pushToast } = useApp()
  const nav = useNavigate()
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
        title: 'Kayıt tamamlandı',
        body: role === 'vet' ? 'DICOM yükleme ekranına yönlendiriliyorsunuz.' : `${ROLE_LABELS[role]} paneline yönlendiriliyorsunuz.`,
      })
      nav(postLoginPath(session.role))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt başarısız')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div className="pointer-events-none absolute -right-32 top-10 h-[420px] w-[420px] rounded-full bg-teal-600/20 blur-3xl" />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col px-6 py-10">
        <Logo dark size="lg" />
        <form onSubmit={onSubmit} className="mt-10 rounded-2xl border border-navy-800 bg-navy-900/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-1 flex items-center gap-2 text-teal-300">
            <UserPlus className="h-5 w-5" />
            <h1 className="text-lg font-semibold text-white">Hesap oluştur</h1>
          </div>
          <p className="text-sm text-navy-300">
            Demo kayıt localStorage&apos;a yazılır. Backend açıksa seed hesaplarla JWT de alınır; özel e-postalar yalnızca UI oturumu alır.
          </p>

          <label className="mt-5 block text-xs font-medium text-navy-300">
            Ad soyad
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            E-posta
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            Şifre (min. 6)
            <input className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label className="mt-4 block text-xs font-medium text-navy-300">
            Rol
            <select className="input mt-1.5 w-full bg-navy-950 text-white ring-navy-700" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>

          {role === 'vet' && (
            <p className="mt-3 rounded-lg bg-teal-500/10 px-3 py-2 text-xs text-teal-100 ring-1 ring-inset ring-teal-500/30">
              Veteriner hekim kayıt sonrası doğrudan DICOM sürükle-bırak ekranına yönlendirilir.
            </p>
          )}

          {error && <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-500/30">{error}</p>}

          <Button type="submit" className="mt-5 w-full" size="lg" disabled={busy} icon={<ArrowRight className="h-4 w-4" />}>
            {busy ? 'Kaydediliyor…' : 'Kayıt ol ve devam et'}
          </Button>

          <p className="mt-4 text-center text-sm text-navy-300">
            Zaten hesabınız var mı?{' '}
            <Link to="/giris" className="font-semibold text-teal-300 hover:underline">
              Giriş yapın
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
