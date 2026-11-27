import { useId } from 'react'

/**
 * Small holographic organ icons for the worklist: glowing line art on a dark background.
 * Schematic on purpose (decoration, not anatomy).
 */

type Props = { region?: string | null; size?: number; className?: string }

type Palette = { stroke: string; fill: string; glow: string }

const CYAN: Palette = { stroke: '#0284c7', fill: '#38bdf8', glow: '#22d3ee' }
const PINK: Palette = { stroke: '#c026d3', fill: '#e879f9', glow: '#f472b6' }
const TEAL: Palette = { stroke: '#0f766e', fill: '#2dd4bf', glow: '#14b8a6' }

function Frame({ palette, size, className, children }: { palette: Palette; size: number; className?: string; children: (ids: { fill: string; glow: string }) => React.ReactNode }) {
  const raw = useId().replace(/:/g, '')
  const ids = { fill: `${raw}-fill`, glow: `${raw}-glow` }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.fill} stopOpacity="0.55" />
          <stop offset="100%" stopColor={palette.fill} stopOpacity="0.12" />
        </linearGradient>
        <filter id={ids.glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${ids.glow})`} stroke={palette.stroke} strokeLinecap="round" strokeLinejoin="round">
        {children({ fill: `url(#${ids.fill})`, glow: palette.glow })}
      </g>
    </svg>
  )
}

function Brain({ size, className }: { size: number; className?: string }) {
  return (
    <Frame palette={CYAN} size={size} className={className}>
      {({ fill }) => (
        <>
          <path
            d="M10 34 C7 24 14 13 26 11 C35 6 48 8 54 17 C60 22 60 32 55 38 C53 44 46 46 41 45 C37 50 30 51 26 47 C20 50 12 46 11 41 C9 39 9 36 10 34 Z"
            fill={fill}
            strokeWidth="1.6"
          />
          <path d="M42 45 C48 46 53 43 55 39 C56 46 51 52 44 51 C41 50 40 47 42 45 Z" fill={fill} strokeWidth="1.3" />
          <path d="M38 50 C38 54 36 57 34 58" strokeWidth="1.6" fill="none" />
          <g strokeWidth="1.1" fill="none" strokeOpacity="0.9">
            <path d="M16 24 C20 19 25 21 27 16" />
            <path d="M30 13 C33 18 38 16 41 20" />
            <path d="M45 14 C46 20 50 21 53 26" />
            <path d="M14 33 C19 29 24 33 28 29" />
            <path d="M31 26 C34 31 40 28 43 33" />
            <path d="M21 40 C26 37 30 41 35 38" />
            <path d="M46 31 C49 35 52 35 55 32" />
            <path d="M44 48 C47 49 50 47 52 45" />
          </g>
        </>
      )}
    </Frame>
  )
}

function Lungs({ size, className }: { size: number; className?: string }) {
  return (
    <Frame palette={PINK} size={size} className={className}>
      {({ fill }) => (
        <>
          <path d="M32 6 V22" strokeWidth="2" fill="none" />
          <path d="M32 22 C28 25 25 27 23 31 M32 22 C36 25 39 27 41 31" strokeWidth="1.6" fill="none" />
          <path d="M28 18 C20 17 12 25 10 37 C8 48 11 56 19 56 C25 56 28 51 28 45 Z" fill={fill} strokeWidth="1.6" />
          <path d="M36 18 C44 17 52 25 54 37 C56 48 53 56 45 56 C39 56 36 51 36 45 Z" fill={fill} strokeWidth="1.6" />
          <g strokeWidth="1" fill="none" strokeOpacity="0.85">
            <path d="M23 31 C20 35 18 39 17 45 M23 33 C24 38 23 43 22 48" />
            <path d="M41 31 C44 35 46 39 47 45 M41 33 C40 38 41 43 42 48" />
          </g>
        </>
      )}
    </Frame>
  )
}

/** Vertebrae along a gentle curve; `neck` tilts the column up like a cervical spine. */
function Spine({ size, className, neck = false }: { size: number; className?: string; neck?: boolean }) {
  const count = neck ? 5 : 7
  const pts = Array.from({ length: count }, (_, i) => {
    if (neck) {
      const tt = i / (count - 1)
      return { x: 14 + tt * 36, y: 50 - tt * 34 + Math.sin(tt * Math.PI) * 6, a: -40 }
    }
    const x = 8 + i * 8
    return { x, y: 34 - Math.sin(((x - 8) / 48) * Math.PI) * 6, a: 0 }
  })
  return (
    <Frame palette={TEAL} size={size} className={className}>
      {({ fill }) => (
        <>
          {pts.map((p, i) => (
            <g key={i} transform={`rotate(${p.a} ${p.x} ${p.y})`}>
              <rect x={p.x - 3.2} y={p.y - 4.5} width="6.4" height="9" rx="2" fill={fill} strokeWidth="1.3" />
              <path d={`M${p.x} ${p.y - 4.5} L${p.x - 1.5} ${p.y - 9}`} strokeWidth="1.2" fill="none" />
            </g>
          ))}
          {pts.slice(0, -1).map((p, i) => {
            const n = pts[i + 1]
            return <circle key={`d${i}`} cx={(p.x + n.x) / 2} cy={(p.y + n.y) / 2} r="1.2" fill="#0f766e" stroke="none" />
          })}
        </>
      )}
    </Frame>
  )
}

function Other({ size, className }: { size: number; className?: string }) {
  return (
    <Frame palette={CYAN} size={size} className={className}>
      {({ fill }) => (
        <>
          <circle cx="32" cy="32" r="22" fill="none" strokeWidth="1.2" strokeDasharray="3 4" strokeOpacity="0.8" />
          <ellipse cx="32" cy="38" rx="8" ry="7" fill={fill} strokeWidth="1.5" />
          <ellipse cx="22.5" cy="28" rx="3.4" ry="4.4" fill={fill} strokeWidth="1.3" />
          <ellipse cx="28.5" cy="22.5" rx="3.4" ry="4.4" fill={fill} strokeWidth="1.3" />
          <ellipse cx="35.5" cy="22.5" rx="3.4" ry="4.4" fill={fill} strokeWidth="1.3" />
          <ellipse cx="41.5" cy="28" rx="3.4" ry="4.4" fill={fill} strokeWidth="1.3" />
        </>
      )}
    </Frame>
  )
}

export function HoloOrgan({ region, size = 32, className }: Props) {
  switch ((region || '').toUpperCase()) {
    case 'BRAIN':
      return <Brain size={size} className={className} />
    case 'THORAX':
      return <Lungs size={size} className={className} />
    case 'CERVICAL':
      return <Spine size={size} className={className} neck />
    case 'THORACOLUMBAR':
      return <Spine size={size} className={className} />
    default:
      return <Other size={size} className={className} />
  }
}
