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

export function Dog3D({ size = 40, className }: IconProps) {
  const id = useIds('head', 'ear', 'muzzle', 'nose', 'shadow', 'tongue')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.head} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
        <radialGradient id={id.ear} cx="40%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#78350f" />
        </radialGradient>
        <radialGradient id={id.muzzle} cx="45%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="100%" stopColor="#fcd34d" />
        </radialGradient>
        <radialGradient id={id.nose} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
        <radialGradient id={id.tongue} cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="100%" stopColor="#e11d48" />
        </radialGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="58" rx="18" ry="3.5" fill={`url(#${id.shadow})`} />
      {/* floppy ears behind the head */}
      <ellipse cx="13.5" cy="32" rx="7.5" ry="14" transform="rotate(18 13.5 32)" fill={`url(#${id.ear})`} />
      <ellipse cx="50.5" cy="32" rx="7.5" ry="14" transform="rotate(-18 50.5 32)" fill={`url(#${id.ear})`} />
      <circle cx="32" cy="31" r="20" fill={`url(#${id.head})`} />
      {/* brows */}
      <path d="M21 23.5 q3.5 -3 7 -0.5" stroke="#92400e" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M36 23 q3.5 -2.5 7 0.5" stroke="#92400e" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* eyes */}
      <circle cx="24.5" cy="29" r="3.6" fill="#1c1917" />
      <circle cx="39.5" cy="29" r="3.6" fill="#1c1917" />
      <circle cx="25.8" cy="27.7" r="1.3" fill="#fff" />
      <circle cx="40.8" cy="27.7" r="1.3" fill="#fff" />
      {/* muzzle, tongue, nose */}
      <ellipse cx="32" cy="41" rx="11.5" ry="8.5" fill={`url(#${id.muzzle})`} />
      <path d="M29 44.5 q3 5.5 6 0 z" fill={`url(#${id.tongue})`} />
      <path d="M32 39 v3 M27.5 42.5 q4.5 3.5 9 0" stroke="#7c2d12" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <ellipse cx="32" cy="36.5" rx="4.8" ry="3.4" fill={`url(#${id.nose})`} />
      <ellipse cx="30.6" cy="35.4" rx="1.5" ry="0.8" fill="#fff" opacity="0.75" />
      {/* specular highlight */}
      <ellipse cx="25" cy="17" rx="8" ry="3.6" fill="#fff" opacity="0.38" transform="rotate(-15 25 17)" />
    </svg>
  )
}

export function Cat3D({ size = 40, className }: IconProps) {
  const id = useIds('head', 'ear', 'muzzle', 'iris', 'shadow')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={id.head} cx="38%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="50%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </radialGradient>
        <linearGradient id={id.ear} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <radialGradient id={id.muzzle} cx="45%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <radialGradient id={id.iris} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#d9f99d" />
          <stop offset="100%" stopColor="#65a30d" />
        </radialGradient>
        <radialGradient id={id.shadow}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="58" rx="18" ry="3.5" fill={`url(#${id.shadow})`} />
      {/* ears */}
      <path d="M12 26 L15.5 6 L29 16 Z" fill={`url(#${id.ear})`} strokeLinejoin="round" />
      <path d="M52 26 L48.5 6 L35 16 Z" fill={`url(#${id.ear})`} strokeLinejoin="round" />
      <path d="M16 20 L17.8 10.5 L25 15.5 Z" fill="#f9a8d4" />
      <path d="M48 20 L46.2 10.5 L39 15.5 Z" fill="#f9a8d4" />
      <ellipse cx="32" cy="34" rx="21.5" ry="18.5" fill={`url(#${id.head})`} />
      {/* eyes */}
      <ellipse cx="23.5" cy="31" rx="3.6" ry="4.2" fill={`url(#${id.iris})`} />
      <ellipse cx="40.5" cy="31" rx="3.6" ry="4.2" fill={`url(#${id.iris})`} />
      <ellipse cx="23.5" cy="31.3" rx="1.1" ry="3.2" fill="#0f172a" />
      <ellipse cx="40.5" cy="31.3" rx="1.1" ry="3.2" fill="#0f172a" />
      <circle cx="24.7" cy="29.4" r="1" fill="#fff" />
      <circle cx="41.7" cy="29.4" r="1" fill="#fff" />
      {/* white muzzle */}
      <ellipse cx="27.6" cy="42" rx="6.4" ry="5.2" fill={`url(#${id.muzzle})`} />
      <ellipse cx="36.4" cy="42" rx="6.4" ry="5.2" fill={`url(#${id.muzzle})`} />
      <ellipse cx="32" cy="46.5" rx="4.5" ry="3" fill={`url(#${id.muzzle})`} />
      <path d="M29.6 38.2 h4.8 l-2.4 2.8 z" fill="#f472b6" strokeLinejoin="round" />
      <path d="M32 41 v2 M29.5 44 q2.5 1.8 5 0" stroke="#64748b" strokeWidth="1" strokeLinecap="round" fill="none" />
      {/* whiskers */}
      <g stroke="#e2e8f0" strokeWidth="0.9" strokeLinecap="round">
        <path d="M21.5 41 L8.5 38.5" />
        <path d="M21.5 43.5 L8.5 44.5" />
        <path d="M42.5 41 L55.5 38.5" />
        <path d="M42.5 43.5 L55.5 44.5" />
      </g>
      <ellipse cx="25" cy="21" rx="8" ry="3.4" fill="#fff" opacity="0.28" transform="rotate(-12 25 21)" />
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
