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

/** Soft sky/navy accents for the pet-owner shell. */
export function OwnerWaveAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 120" fill="none" aria-hidden>
      <path
        d="M0 70C56 46 88 94 140 70C192 46 224 94 276 70C328 46 352 88 400 66V120H0V70Z"
        fill="url(#ownerWave)"
        opacity="0.55"
      />
      <path
        d="M0 90C64 66 96 108 152 84C208 60 240 104 296 80C352 56 372 96 400 78V120H0V90Z"
        fill="url(#ownerWave2)"
        opacity="0.35"
      />
      <defs>
        <linearGradient id="ownerWave" x1="0" y1="40" x2="400" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38BDF8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#0EA5E9" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="ownerWave2" x1="0" y1="60" x2="400" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#102A43" stopOpacity="0.22" />
          <stop offset="1" stopColor="#38BDF8" stopOpacity="0.06" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function OwnerPawAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" aria-hidden>
      <ellipse cx="38" cy="34" rx="10" ry="13" fill="#38BDF8" fillOpacity="0.28" />
      <ellipse cx="62" cy="26" rx="10" ry="13" fill="#7DD3FC" fillOpacity="0.32" />
      <ellipse cx="86" cy="34" rx="10" ry="13" fill="#38BDF8" fillOpacity="0.28" />
      <ellipse cx="48" cy="52" rx="8" ry="10" fill="#0EA5E9" fillOpacity="0.22" />
      <ellipse cx="76" cy="52" rx="8" ry="10" fill="#0EA5E9" fillOpacity="0.22" />
      <ellipse cx="62" cy="78" rx="22" ry="18" fill="#102A43" fillOpacity="0.18" />
    </svg>
  )
}

/** Indigo/navy accents for the clinic-owner operations shell. */
export function ClinicWaveAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 120" fill="none" aria-hidden>
      <path
        d="M0 74C52 50 84 98 136 74C188 50 220 98 272 74C324 50 356 92 400 70V120H0V74Z"
        fill="url(#clinicWave)"
        opacity="0.55"
      />
      <path
        d="M0 92C60 68 96 110 148 86C200 62 236 106 288 82C340 58 368 98 400 80V120H0V92Z"
        fill="url(#clinicWave2)"
        opacity="0.35"
      />
      <defs>
        <linearGradient id="clinicWave" x1="0" y1="40" x2="400" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818CF8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#6366F1" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="clinicWave2" x1="0" y1="60" x2="400" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#102A43" stopOpacity="0.25" />
          <stop offset="1" stopColor="#818CF8" stopOpacity="0.06" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function ClinicGridAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden>
      <rect x="28" y="28" width="40" height="40" rx="8" stroke="#A5B4FC" strokeOpacity="0.35" strokeWidth="1.2" />
      <rect x="84" y="28" width="40" height="40" rx="8" stroke="#6366F1" strokeOpacity="0.4" strokeWidth="1.2" />
      <rect x="28" y="84" width="40" height="40" rx="8" stroke="#6366F1" strokeOpacity="0.4" strokeWidth="1.2" />
      <rect x="84" y="84" width="40" height="40" rx="8" stroke="#A5B4FC" strokeOpacity="0.3" strokeWidth="1.2" />
      <circle cx="48" cy="48" r="3" fill="#818CF8" fillOpacity="0.7" />
      <circle cx="104" cy="48" r="3" fill="#6366F1" fillOpacity="0.65" />
      <circle cx="48" cy="104" r="3" fill="#6366F1" fillOpacity="0.65" />
      <circle cx="104" cy="104" r="3" fill="#A5B4FC" fillOpacity="0.55" />
      <path d="M48 48H104M48 48V104M104 48V104M48 104H104" stroke="#818CF8" strokeOpacity="0.22" strokeWidth="1" />
    </svg>
  )
}

/** Slate / emerald accents for the system-admin control plane. */
export function AdminWaveAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 120" fill="none" aria-hidden>
      <path
        d="M0 76C48 52 80 100 132 76C184 52 216 100 268 76C320 52 352 94 400 72V120H0V76Z"
        fill="url(#adminWave)"
        opacity="0.55"
      />
      <path
        d="M0 94C56 70 92 112 144 88C196 64 232 108 284 84C336 60 364 100 400 82V120H0V94Z"
        fill="url(#adminWave2)"
        opacity="0.35"
      />
      <defs>
        <linearGradient id="adminWave" x1="0" y1="40" x2="400" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34D399" stopOpacity="0.35" />
          <stop offset="1" stopColor="#64748B" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="adminWave2" x1="0" y1="60" x2="400" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0F172A" stopOpacity="0.28" />
          <stop offset="1" stopColor="#34D399" stopOpacity="0.06" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function AdminCircuitAccent({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden>
      <circle cx="80" cy="80" r="52" stroke="#94A3B8" strokeOpacity="0.28" strokeWidth="1" />
      <circle cx="80" cy="80" r="26" stroke="#34D399" strokeOpacity="0.4" strokeWidth="1.2" />
      <circle cx="80" cy="28" r="3.5" fill="#34D399" fillOpacity="0.75" />
      <circle cx="132" cy="80" r="3" fill="#94A3B8" fillOpacity="0.7" />
      <circle cx="80" cy="132" r="3" fill="#34D399" fillOpacity="0.55" />
      <circle cx="28" cy="80" r="3" fill="#94A3B8" fillOpacity="0.55" />
      <path d="M80 28V54M106 80H132M80 106V132M54 80H28" stroke="#94A3B8" strokeOpacity="0.3" strokeWidth="1" />
      <path d="M98 62L118 42M62 98L42 118" stroke="#34D399" strokeOpacity="0.28" strokeWidth="1" />
    </svg>
  )
}
