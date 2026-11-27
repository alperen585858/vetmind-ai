import { useId } from 'react'
import type { Species } from '../types'

/**
 * VetMind species icons in a soft "clay toy" 3D style: radial gradients for volume,
 * a specular highlight on top and a contact shadow underneath. Pure SVG, no assets.
 */

type IconProps = { size?: number; className?: string }

function useIds(...names: string[]) {
  const base = useId().replace(/:/g, '')
  return Object.fromEntries(names.map((n) => [n, `${base}-${n}`])) as Record<string, string>
}

/** Big glossy kawaii eye: dark iris, a large shine and a small one. */
function Eye({ cx, cy, r, iris }: { cx: number; cy: number; r: number; iris: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={iris} />
      <circle cx={cx} cy={cy + r * 0.15} r={r * 0.62} fill="#0b0b12" />
      <circle cx={cx + r * 0.32} cy={cy - r * 0.34} r={r * 0.36} fill="#fff" />
      <circle cx={cx - r * 0.38} cy={cy + r * 0.38} r={r * 0.15} fill="#fff" opacity="0.9" />
    </g>
  )
}

export function Dog3D({ size = 40, className }: IconProps) {
  const id = useIds('head', 'ear', 'muzzle', 'nose', 'shadow', 'tongue', 'iris')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.head} cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fff1c2" />
          <stop offset="45%" stopColor="#fbbf4d" />
          <stop offset="100%" stopColor="#d97706" />
        </radialGradient>
        <radialGradient id={id.ear} cx="40%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#c2721c" />
          <stop offset="100%" stopColor="#7c3a10" />
        </radialGradient>
        <radialGradient id={id.muzzle} cx="45%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#fde7b0" />
        </radialGradient>
        <radialGradient id={id.nose} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6b5b57" />
          <stop offset="100%" stopColor="#1c1414" />
        </radialGradient>
        <radialGradient id={id.tongue} cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fecdd3" />
          <stop offset="100%" stopColor="#f43f5e" />
        </radialGradient>
        <radialGradient id={id.iris} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#8a5a2b" />
          <stop offset="100%" stopColor="#3b2412" />
        </radialGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="58.5" rx="18" ry="3.5" fill={`url(#${id.shadow})`} />
      {/* short, round floppy ears */}
      <ellipse cx="12.5" cy="31" rx="7.5" ry="11.5" transform="rotate(22 12.5 31)" fill={`url(#${id.ear})`} />
      <ellipse cx="51.5" cy="31" rx="7.5" ry="11.5" transform="rotate(-22 51.5 31)" fill={`url(#${id.ear})`} />
      {/* round, slightly wide head */}
      <ellipse cx="32" cy="33" rx="21" ry="19.5" fill={`url(#${id.head})`} />
      {/* little tuft */}
      <path d="M27.5 15 q2.5 -5 4.5 -1 q2 -4.5 4.5 1" fill="#fbbf4d" stroke="#e8a23a" strokeWidth="0.6" />
      {/* big eyes */}
      <Eye cx={23.5} cy={31} r={5} iris={`url(#${id.iris})`} />
      <Eye cx={40.5} cy={31} r={5} iris={`url(#${id.iris})`} />
      {/* blush */}
      <ellipse cx="16.5" cy="39.5" rx="3.6" ry="2.2" fill="#fb7185" opacity="0.45" />
      <ellipse cx="47.5" cy="39.5" rx="3.6" ry="2.2" fill="#fb7185" opacity="0.45" />
      {/* small muzzle, tongue, nose */}
      <ellipse cx="32" cy="42.5" rx="8.5" ry="6.5" fill={`url(#${id.muzzle})`} />
      <path d="M29.6 45 q2.4 6 4.8 0 z" fill={`url(#${id.tongue})`} />
      <path d="M32 41.3 v1.8 M28.5 43.6 q1.8 1.8 3.5 0 q1.7 1.8 3.5 0" stroke="#8a4a1c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M28.6 38.6 q3.4 -2.6 6.8 0 q-0.4 2.8 -3.4 3.4 q-3 -0.6 -3.4 -3.4 z" fill={`url(#${id.nose})`} />
      <ellipse cx="31" cy="38.4" rx="1.3" ry="0.6" fill="#fff" opacity="0.8" />
      {/* specular highlight */}
      <ellipse cx="25" cy="19.5" rx="8" ry="3.4" fill="#fff" opacity="0.45" transform="rotate(-15 25 19.5)" />
    </svg>
  )
}

export function Cat3D({ size = 40, className }: IconProps) {
  const id = useIds('head', 'ear', 'muzzle', 'iris', 'shadow')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.head} cx="40%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#a5b4c8" />
          <stop offset="50%" stopColor="#5b6b82" />
          <stop offset="100%" stopColor="#2b3547" />
        </radialGradient>
        <linearGradient id={id.ear} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c8aa0" />
          <stop offset="100%" stopColor="#3f4a5e" />
        </linearGradient>
        <radialGradient id={id.muzzle} cx="45%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d7dee8" />
        </radialGradient>
        <radialGradient id={id.iris} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#bef264" />
          <stop offset="100%" stopColor="#3f7d12" />
        </radialGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="58.5" rx="18" ry="3.5" fill={`url(#${id.shadow})`} />
      {/* soft rounded ears */}
      <path d="M11.5 27 Q11 10 16.5 7.5 Q20 7 29 16 Z" fill={`url(#${id.ear})`} />
      <path d="M52.5 27 Q53 10 47.5 7.5 Q44 7 35 16 Z" fill={`url(#${id.ear})`} />
      <path d="M15 21.5 Q15 12.5 17.5 11.5 Q19.5 11.5 24.5 16 Z" fill="#f9a8d4" />
      <path d="M49 21.5 Q49 12.5 46.5 11.5 Q44.5 11.5 39.5 16 Z" fill="#f9a8d4" />
      {/* chubby round head */}
      <ellipse cx="32" cy="34.5" rx="22" ry="19" fill={`url(#${id.head})`} />
      {/* big round eyes */}
      <Eye cx={23} cy={32} r={5.2} iris={`url(#${id.iris})`} />
      <Eye cx={41} cy={32} r={5.2} iris={`url(#${id.iris})`} />
      {/* blush */}
      <ellipse cx="15.5" cy="40.5" rx="3.6" ry="2.2" fill="#f472b6" opacity="0.5" />
      <ellipse cx="48.5" cy="40.5" rx="3.6" ry="2.2" fill="#f472b6" opacity="0.5" />
      {/* small white muzzle with an ω mouth */}
      <ellipse cx="28.4" cy="43.2" rx="4.8" ry="3.9" fill={`url(#${id.muzzle})`} />
      <ellipse cx="35.6" cy="43.2" rx="4.8" ry="3.9" fill={`url(#${id.muzzle})`} />
      <path d="M30.4 40 q1.6 -1 3.2 0 q-0.3 1.7 -1.6 2.1 q-1.3 -0.4 -1.6 -2.1 z" fill="#f472b6" />
      <path d="M28.6 44.2 q1.7 1.6 3.4 0 q1.7 1.6 3.4 0" stroke="#5b6b82" strokeWidth="1" strokeLinecap="round" fill="none" />
      {/* whiskers */}
      <g stroke="#eef2f7" strokeWidth="0.9" strokeLinecap="round">
        <path d="M22.5 42.5 L10 40.5" />
        <path d="M22.5 44.8 L10.5 46" />
        <path d="M41.5 42.5 L54 40.5" />
        <path d="M41.5 44.8 L53.5 46" />
      </g>
      <ellipse cx="25" cy="21.5" rx="8" ry="3.4" fill="#fff" opacity="0.3" transform="rotate(-12 25 21.5)" />
    </svg>
  )
}

export function Rabbit3D({ size = 40, className }: IconProps) {
  const id = useIds('body', 'ear', 'iris', 'shadow')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.body} cx="40%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </radialGradient>
        <linearGradient id={id.ear} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <radialGradient id={id.iris} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="100%" stopColor="#0284c7" />
        </radialGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="59" rx="16" ry="3.2" fill={`url(#${id.shadow})`} />
      {/* ears */}
      <ellipse cx="24" cy="15" rx="5.5" ry="13" transform="rotate(-10 24 15)" fill={`url(#${id.ear})`} />
      <ellipse cx="40" cy="15" rx="5.5" ry="13" transform="rotate(10 40 15)" fill={`url(#${id.ear})`} />
      <ellipse cx="24" cy="15.5" rx="2.4" ry="9.5" transform="rotate(-10 24 15.5)" fill="#fbcfe8" />
      <ellipse cx="40" cy="15.5" rx="2.4" ry="9.5" transform="rotate(10 40 15.5)" fill="#fbcfe8" />
      {/* egg-shaped body */}
      <path d="M32 22 C45 22 50 34 50 43 C50 53 42 58 32 58 C22 58 14 53 14 43 C14 34 19 22 32 22 Z" fill={`url(#${id.body})`} />
      {/* eyes */}
      <circle cx="25" cy="38" r="3.8" fill={`url(#${id.iris})`} />
      <circle cx="39" cy="38" r="3.8" fill={`url(#${id.iris})`} />
      <circle cx="25" cy="38.3" r="2" fill="#0f172a" />
      <circle cx="39" cy="38.3" r="2" fill="#0f172a" />
      <circle cx="26.1" cy="37" r="0.95" fill="#fff" />
      <circle cx="40.1" cy="37" r="0.95" fill="#fff" />
      {/* cheeks, nose, teeth */}
      <ellipse cx="20.5" cy="44.5" rx="3" ry="1.8" fill="#f9a8d4" opacity="0.6" />
      <ellipse cx="43.5" cy="44.5" rx="3" ry="1.8" fill="#f9a8d4" opacity="0.6" />
      <ellipse cx="32" cy="43" rx="1.6" ry="1.1" fill="#f472b6" />
      <path d="M29.5 45 q2.5 1.6 5 0" stroke="#94a3b8" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <rect x="30.7" y="45.6" width="2.6" height="2.6" rx="0.6" fill="#fff" stroke="#cbd5e1" strokeWidth="0.5" />
      {/* paws */}
      <ellipse cx="25" cy="52.5" rx="4" ry="2.6" fill="#f1f5f9" />
      <ellipse cx="39" cy="52.5" rx="4" ry="2.6" fill="#f1f5f9" />
      <ellipse cx="26" cy="28" rx="6.5" ry="3" fill="#fff" opacity="0.7" transform="rotate(-20 26 28)" />
    </svg>
  )
}

export function SpeciesIcon3D({ species, size = 40, className }: IconProps & { species: Species | string }) {
  if (species === 'Köpek') return <Dog3D size={size} className={className} />
  if (species === 'Kedi') return <Cat3D size={size} className={className} />
  return <Rabbit3D size={size} className={className} />
}
