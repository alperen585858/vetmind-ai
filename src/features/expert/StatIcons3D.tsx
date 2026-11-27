import { useId } from 'react'

/** Glossy 3D-style icons for the worklist stat cards (decoration only). */

type IconProps = { size?: number; className?: string }

function useIds(...names: string[]) {
  const raw = useId().replace(/:/g, '')
  return Object.fromEntries(names.map((n) => [n, `${raw}-${n}`])) as Record<string, string>
}

/** Three stacked teal layers. */
export function Stack3D({ size = 72, className }: IconProps) {
  const id = useIds('top', 'side', 'shadow')
  const layer = (y: number, opacity: number) => (
    <g key={y} opacity={opacity}>
      <path d={`M40 ${y + 12} L68 ${y + 24} L40 ${y + 36} L12 ${y + 24} Z`} fill={`url(#${id.side})`} />
      <path d={`M40 ${y} L68 ${y + 12} L40 ${y + 24} L12 ${y + 12} Z`} fill={`url(#${id.top})`} stroke="#ccfbf1" strokeWidth="0.8" />
      <path d={`M12 ${y + 12} V${y + 17} L40 ${y + 29} L68 ${y + 17} V${y + 12} L40 ${y + 24} Z`} fill="#0f766e" opacity="0.85" />
    </g>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={className} aria-hidden>
      <defs>
        <linearGradient id={id.top} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#99f6e4" />
          <stop offset="55%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
        <linearGradient id={id.side} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f766e" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="40" cy="70" rx="28" ry="5" fill={`url(#${id.shadow})`} />
      {layer(36, 1)}
      {layer(24, 1)}
      {layer(12, 1)}
    </svg>
  )
}

/** Red emergency beacon. */
export function Siren3D({ size = 72, className }: IconProps) {
  const id = useIds('dome', 'base', 'shine', 'glow')
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.dome} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fecdd3" />
          <stop offset="35%" stopColor="#fb7185" />
          <stop offset="75%" stopColor="#e11d48" />
          <stop offset="100%" stopColor="#9f1239" />
        </radialGradient>
        <linearGradient id={id.base} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="45%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id={id.shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id.glow}>
          <stop offset="0%" stopColor="#fb7185" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="38" r="34" fill={`url(#${id.glow})`} />
      <g stroke="#f43f5e" strokeWidth="2.4" strokeLinecap="round" opacity="0.7">
        <path d="M40 4 V9" />
        <path d="M14 14 L18 18" />
        <path d="M66 14 L62 18" />
      </g>
      <path d="M20 58 V38 C20 24 29 16 40 16 C51 16 60 24 60 38 V58 Z" fill={`url(#${id.dome})`} />
      <path d="M26 54 V38 C26 28 31 22 36 20" stroke={`url(#${id.shine})`} strokeWidth="4" strokeLinecap="round" fill="none" />
      <rect x="15" y="56" width="50" height="12" rx="4" fill={`url(#${id.base})`} />
      <rect x="17" y="57" width="46" height="2.5" rx="1.2" fill="#fff" opacity="0.25" />
    </svg>
  )
}

/** Golden alarm clock. */
export function Clock3D({ size = 72, className }: IconProps) {
  const id = useIds('rim', 'face', 'bell')
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={className} aria-hidden>
      <defs>
        <linearGradient id={id.rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <radialGradient id={id.face} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="100%" stopColor="#fde68a" />
        </radialGradient>
        <linearGradient id={id.bell} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <ellipse cx="40" cy="74" rx="22" ry="3.5" fill="#b45309" opacity="0.18" />
      <path d="M12 22 A12 12 0 0 1 28 10 Z" fill={`url(#${id.bell})`} />
      <path d="M68 22 A12 12 0 0 0 52 10 Z" fill={`url(#${id.bell})`} />
      <path d="M24 66 L19 73 M56 66 L61 73" stroke="#b45309" strokeWidth="4" strokeLinecap="round" />
      <circle cx="40" cy="42" r="28" fill={`url(#${id.rim})`} />
      <circle cx="40" cy="42" r="22" fill={`url(#${id.face})`} />
      <g stroke="#b45309" strokeWidth="2" strokeLinecap="round">
        <path d="M40 23 V26.5" />
        <path d="M40 57.5 V61" />
        <path d="M21 42 H24.5" />
        <path d="M55.5 42 H59" />
      </g>
      <path d="M40 42 V30" stroke="#78350f" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 42 L49 47" stroke="#78350f" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="40" cy="42" r="2.6" fill="#dc2626" />
      <path d="M22 32 C25 24 32 19 40 18" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  )
}

/** Two blue user figures. */
export function Users3D({ size = 72, className }: IconProps) {
  const id = useIds('front', 'back')
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.front} cx="35%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="45%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0369a1" />
        </radialGradient>
        <radialGradient id={id.back} cx="35%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="50%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0284c7" />
        </radialGradient>
      </defs>
      <ellipse cx="40" cy="73" rx="26" ry="3.5" fill="#0369a1" opacity="0.18" />
      <circle cx="52" cy="22" r="10" fill={`url(#${id.back})`} />
      <path d="M36 56 C36 42 44 35 52 35 C61 35 69 42 69 56 C69 60 66 62 62 62 H42 C38 62 36 60 36 56 Z" fill={`url(#${id.back})`} />
      <circle cx="32" cy="30" r="12" fill={`url(#${id.front})`} />
      <path d="M12 66 C12 51 21 44 32 44 C43 44 52 51 52 66 C52 70 49 72 45 72 H19 C15 72 12 70 12 66 Z" fill={`url(#${id.front})`} />
      <ellipse cx="28" cy="25" rx="4" ry="3" fill="#fff" opacity="0.55" />
      <ellipse cx="49" cy="18" rx="3.4" ry="2.4" fill="#fff" opacity="0.55" />
    </svg>
  )
}
