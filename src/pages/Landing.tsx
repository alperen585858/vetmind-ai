import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Menu, UserRound, X } from 'lucide-react'

const NAV = [
  { label: 'Hizmetler', href: '#hizmetler' },
  { label: 'Nasıl çalışır', href: '#nasil' },
  { label: 'Hakkında', href: '#hakkinda' },
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white font-display text-navy-900">
      {/* Header */}
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
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Giriş
            </Link>
            <Link
              to="/kayit"
              className="hidden items-center gap-2 rounded-full border border-sky-400 bg-white px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 sm:inline-flex"
            >
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              Kayıt
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-navy-800 text-white transition hover:bg-navy-900"
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="landing-menu"
            className="animate-fade-up border-t border-sky-100 bg-white px-4 py-4 sm:px-6 lg:px-8"
          >
            <ul className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:gap-6">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-sm font-medium text-navy-800 transition hover:bg-sky-50 hover:text-sky-700"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li className="sm:hidden">
                <Link
                  to="/kayit"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-sky-600"
                >
                  Kayıt ol
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      {/* Hero — full-bleed */}
      <section className="relative isolate min-h-[calc(100vh-72px)] overflow-hidden">
        <div className="absolute inset-0">
          <HeroBackdrop />
          <div className="absolute inset-0 bg-gradient-to-r from-sky-900/85 via-sky-800/55 to-sky-600/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950/50 via-transparent to-sky-900/20" />
        </div>

        <div className="relative mx-auto flex min-h-[calc(100vh-72px)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <p className="landing-reveal text-sm font-semibold uppercase tracking-[0.22em] text-sky-200/90">
            VetMind AI
          </p>
          <h1 className="landing-reveal landing-reveal-delay-1 mt-4 max-w-xl text-[2.15rem] font-bold leading-[1.12] tracking-tight text-white sm:text-5xl lg:max-w-2xl lg:text-[3.25rem]">
            Sektörün önde gelen veteriner tanı görüntüleme ve nöroloji uzmanlığı
          </h1>
          <p className="landing-reveal landing-reveal-delay-2 mt-5 max-w-md text-base leading-relaxed text-sky-100/90 sm:text-lg">
            Hızlı, klinik odaklı genel görüntüleme ve nörogörüntüleme raporlarıyla pratikteki meslektaşlarımıza destek.
          </p>

          <div className="landing-reveal landing-reveal-delay-3 mt-10 flex items-center gap-6 lg:mt-0 lg:absolute lg:right-[8%] lg:top-1/2 lg:-translate-y-1/2">
            <Link
              to="/giris"
              className="landing-cta group relative flex h-36 w-36 flex-col items-center justify-center rounded-full bg-sky-500 text-center text-white shadow-[0_12px_40px_rgba(14,165,233,0.45)] transition duration-300 hover:scale-105 hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:h-44 sm:w-44"
            >
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Başlayın
              </span>
              <span className="mt-1 text-sm font-bold uppercase tracking-wide sm:text-base">
                Vaka Gönder
              </span>
              <span className="mt-0.5 text-lg transition group-hover:translate-x-1" aria-hidden>
                →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Intro strip */}
      <section id="hakkinda" className="bg-sky-600 px-4 py-14 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-3xl text-center text-base leading-relaxed text-white sm:text-lg">
          VetMind AI Teleradyoloji; DICOM yükleme, AI destekli taslak rapor ve uzman veteriner radyolog onayıyla
          çalışan, klinik odaklı bir hizmet prototipidir. Pratikteki meslektaşlarımıza hızlı ve yapılandırılmış
          görüntüleme desteği sunmak için tasarlandı.
        </p>
      </section>

      {/* Services */}
      <section id="hizmetler" className="bg-sky-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            Hizmetler
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-navy-600">
            Genel görüntüleme ve nörogörüntüleme için tek akışta yükleme, analiz ve uzman incelemesi.
          </p>
          <ul className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: 'DICOM yükleme',
                text: 'Çalışma, seri ve kesit metadata’sını güvenli karantinaya alın; tür ve modaliteyi onaylayın.',
              },
              {
                title: 'AI taslak rapor',
                text: 'Görüntü ve klinik bağlamdan yapılandırılmış bulgular; her çıktı uzman onayı için hazırlanır.',
              },
              {
                title: 'Uzman inceleme',
                text: 'Veteriner radyolog onay, red veya revizyon ile klinik sorumluluğu korur.',
              },
            ].map((item) => (
              <li key={item.title} className="text-center">
                <h3 className="text-lg font-semibold text-navy-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="nasil" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">Nasıl çalışır</h2>
          <ol className="mt-10 space-y-6 text-left">
            {[
              'Hesabınıza giriş yapın veya demo kimlikleriyle oturum açın.',
              'DICOM veya demo vaka yükleyin; sınıflandırmayı onaylayın.',
              'AI pipeline taslak raporu üretir; uzman kuyruğunda incelenir.',
              'Onaylanan rapor klinik ekibe sunulur — AI tanı koymaz.',
            ].map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <p className="pt-1 text-navy-700">{step}</p>
              </li>
            ))}
          </ol>
          <Link
            to="/giris"
            className="mt-12 inline-flex items-center rounded-full bg-navy-900 px-8 py-3 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Demo’ya giriş yap
          </Link>
        </div>
      </section>

      <footer className="border-t border-sky-100 bg-navy-950 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <p className="text-sm text-sky-200/80">
            © {new Date().getFullYear()} VetMind AI · Bitirme projesi prototipi · Klinik üretim sistemi değildir
          </p>
          <div className="flex gap-4 text-sm text-sky-300/90">
            <Link to="/giris" className="hover:text-white">
              Giriş
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

/** Atmospheric medical-imaging plane — blue-tinted scan grid + soft figure silhouette */
function HeroBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-sky-800" aria-hidden>
      <div className="landing-hero-pan absolute inset-0 opacity-90">
        <svg className="h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="scanGlow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
              <stop offset="55%" stopColor="#0369a1" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.8" />
            </linearGradient>
            <radialGradient id="brainGlow" cx="50%" cy="45%" r="45%">
              <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.55" />
              <stop offset="70%" stopColor="#0284c7" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0" />
            </radialGradient>
            <filter id="softBlur">
              <feGaussianBlur stdDeviation="18" />
            </filter>
          </defs>

          <rect width="1600" height="900" fill="url(#scanGlow)" />

          {/* Soft figure silhouette (left) */}
          <ellipse cx="280" cy="520" rx="160" ry="280" fill="#082f49" opacity="0.55" filter="url(#softBlur)" />
          <ellipse cx="280" cy="280" rx="70" ry="85" fill="#0c4a6e" opacity="0.45" filter="url(#softBlur)" />

          {/* MRI-style panel grid (right) */}
          {Array.from({ length: 12 }).map((_, i) => {
            const col = i % 4
            const row = Math.floor(i / 4)
            const x = 820 + col * 175
            const y = 140 + row * 200
            return (
              <g key={i} opacity={0.85}>
                <rect x={x} y={y} width={155} height={175} rx="4" fill="#0c4a6e" stroke="#38bdf8" strokeOpacity="0.25" />
                <ellipse cx={x + 78} cy={y + 80} rx={48} ry={58} fill="url(#brainGlow)" />
                <path
                  d={`M${x + 40} ${y + 75} Q${x + 78} ${y + 40} ${x + 116} ${y + 78} Q${x + 78} ${y + 120} ${x + 40} ${y + 75}`}
                  fill="none"
                  stroke="#bae6fd"
                  strokeOpacity="0.45"
                  strokeWidth="1.5"
                />
                <circle cx={x + 70} cy={y + 72} r="3" fill="#e0f2fe" opacity="0.5" />
                <line x1={x + 20} y1={y + 150} x2={x + 135} y2={y + 150} stroke="#38bdf8" strokeOpacity="0.2" />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
