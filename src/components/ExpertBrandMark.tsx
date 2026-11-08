/** Subtle SVG accents for expert premium shell — decorative only. */

export function ExpertWaveAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 120" fill="none" aria-hidden>
      <path
        d="M0 72C48 48 72 96 120 72C168 48 192 96 240 72C288 48 312 96 360 72C376 64 392 56 400 52V120H0V72Z"
        fill="url(#vmWave)"
        opacity="0.55"
      />
      <path
        d="M0 88C56 64 88 104 140 80C192 56 220 100 272 76C324 52 348 92 400 70V120H0V88Z"
        fill="url(#vmWave2)"
        opacity="0.35"
      />
      <defs>
        <linearGradient id="vmWave" x1="0" y1="40" x2="400" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0D9488" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5EEAD4" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="vmWave2" x1="0" y1="60" x2="400" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#102A43" stopOpacity="0.2" />
          <stop offset="1" stopColor="#0D9488" stopOpacity="0.05" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function ExpertNodeAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden>
      <circle cx="80" cy="80" r="54" stroke="#5EEAD4" strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="80" cy="80" r="28" stroke="#0D9488" strokeOpacity="0.35" strokeWidth="1.2" />
      <circle cx="80" cy="26" r="3.5" fill="#5EEAD4" fillOpacity="0.7" />
      <circle cx="128" cy="108" r="3" fill="#0D9488" fillOpacity="0.65" />
      <circle cx="36" cy="112" r="2.5" fill="#5EEAD4" fillOpacity="0.55" />
      <path d="M80 26L128 108L36 112Z" stroke="#5EEAD4" strokeOpacity="0.28" strokeWidth="1" />
    </svg>
  )
}
