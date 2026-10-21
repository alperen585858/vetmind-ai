import { ArrowRight, Microscope, PawPrint, ServerCog, Stethoscope } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Logo } from '../components/Logo'
import { USERS } from '../data/mock'
import type { Role } from '../types'

const ROLES: { role: Role; title: string; desc: string; icon: ReactNode; accent: string }[] = [
  { role: 'vet', title: 'Veteriner Hekim (Klinik)', desc: 'Vaka oluşturur, tetkik yükler, onaylı raporu görür.', icon: <Stethoscope className="h-6 w-6" />, accent: 'from-teal-500 to-teal-700' },
  { role: 'expert', title: 'Uzman Veteriner Hekim (VRM)', desc: 'AI taslaklarını inceler, düzenler, onaylar veya reddeder.', icon: <Microscope className="h-6 w-6" />, accent: 'from-violet-500 to-violet-700' },
  { role: 'owner', title: 'Hayvan Sahibi', desc: 'Hayvanının vakalarını ve onaylanmış raporları görür.', icon: <PawPrint className="h-6 w-6" />, accent: 'from-sky-500 to-sky-700' },
  { role: 'admin', title: 'Sistem Yöneticisi', desc: 'Modüller, bilgi tabanı ve sistem durumu.', icon: <ServerCog className="h-6 w-6" />, accent: 'from-slate-500 to-navy-700' },
]

export default function Login() {
  const { setRole } = useApp()
  const nav = useNavigate()

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-teal-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[420px] w-[420px] rounded-full bg-navy-600/40 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <div className="flex items-center justify-between">
          <Logo dark size="lg" />
          <span className="rounded-full border border-navy-700 px-3 py-1 text-xs text-navy-300">Demo prototip · mock veri</span>
        </div>

        <div className="mt-14 max-w-2xl lg:mt-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-teal-400">Veteriner Klinik Değerlendirme ve Raporlama Platformu</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Veteriner hekimin yerini almaz;
            <br />
            <span className="text-teal-300">değerlendirme sürecini güçlendirir.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-navy-200">
            Tetkik belgelerini işler, nöroloji bilgi tabanından kaynak getirir, kaynaklı bir ön değerlendirme üretir ve uzman hekim onayına sunar.
          </p>
        </div>

        <div className="mt-12">
          <p className="mb-4 text-sm font-medium text-navy-200">Devam etmek için bir rol seçin</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <button
                key={r.role}
                onClick={() => {
                  setRole(r.role)
                  nav('/')
                }}
                className="group flex flex-col rounded-2xl border border-navy-800 bg-navy-900/70 p-5 text-left backdrop-blur transition hover:-translate-y-0.5 hover:border-teal-500/60 hover:bg-navy-900"
              >
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white ${r.accent}`}>{r.icon}</div>
                <p className="font-semibold text-white">{r.title}</p>
                <p className="mt-1 flex-1 text-sm text-navy-300">{r.desc}</p>
                <div className="mt-4 flex items-center justify-between border-t border-navy-800 pt-3 text-xs text-navy-300">
                  <span>{USERS[r.role].name}</span>
                  <ArrowRight className="h-4 w-4 text-teal-400 transition group-hover:translate-x-1" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-12 text-xs text-navy-400">
          Acıbadem Üniversitesi Bilgisayar Mühendisliği Bitirme Projesi · VRM Teknoloji iş birliğiyle
        </div>
      </div>
    </div>
  )
}
