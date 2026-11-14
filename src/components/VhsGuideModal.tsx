import { useEffect, useState } from 'react'
import { useLocale } from '../context/LocaleContext'
import { rememberVhsGuideChoice, VHS_GUIDE_SNOOZE_DAYS } from '../lib/vhsGuidePref'
import { Button } from './Button'
import { Modal } from './Modal'

// Schematic lateral thorax: spine T1–T9 on top, heart below (not to scale).
const VERT_X = (i: number) => 30 + i * 30
// Cranial (front, left in this view) edges of T4 and T8.
const T4 = { x: VERT_X(3) - 11, y: 48 }
const T8 = { x: VERT_X(7) - 11, y: 48 }
const A = { x: 140, y: 70 } // 1: below the carina (ventral border of the left mainstem bronchus)
const B = { x: 212, y: 158 } // 2: cardiac apex
const C = { x: 207, y: 86 } // 3–4: widest part, perpendicular to 1→2
const D = { x: 141, y: 138 }

function Dot({ x, y, label, color, below = false }: { x: number; y: number; label: string; color: string; below?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={4.5} fill={color} stroke="#0b1727" strokeWidth={1.5} />
      <text x={x + (below ? -3 : 7)} y={below ? y + 16 : y - 6} fill="#fff" fontSize={10} fontFamily="monospace" fontWeight={700}>
        {label}
      </text>
    </g>
  )
}

/** Labelled sketch of where the six VHS points go. */
export function VhsDiagram({ title }: { title: string }) {
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label={title} className="w-full rounded-lg bg-[#0b1727]">
      <title>{title}</title>
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i}>
          <rect x={VERT_X(i) - 11} y={20} width={22} height={20} rx={4} fill="#334155" />
          <text x={VERT_X(i)} y={34} fill="#cbd5e1" fontSize={8} textAnchor="middle" fontFamily="monospace">
            T{i + 1}
          </text>
        </g>
      ))}
      <ellipse
        cx={176}
        cy={114}
        rx={64}
        ry={44}
        // Major axis along 1→2 (long axis), so 3→4 runs across the widest part.
        transform="rotate(51 176 114)"
        fill="rgba(251,113,133,0.18)"
        stroke="#fb7185"
        strokeOpacity={0.5}
      />
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#fb7185" strokeWidth={2.5} />
      <line x1={C.x} y1={C.y} x2={D.x} y2={D.y} stroke="#fda4af" strokeWidth={2.5} />
      <line x1={T4.x} y1={T4.y} x2={T8.x} y2={T8.y} stroke="#38bdf8" strokeWidth={2.5} />
      {[1, 2, 3].map((k) => (
        <circle key={k} cx={T4.x + ((T8.x - T4.x) * k) / 4} cy={T4.y} r={2.5} fill="#38bdf8" />
      ))}
      <Dot {...A} label="1" color="#fb7185" />
      <Dot {...B} label="2" color="#fb7185" />
      <Dot {...C} label="3" color="#fda4af" />
      <Dot {...D} label="4" color="#fda4af" />
      <Dot {...T4} label="5" color="#38bdf8" below />
      <Dot {...T8} label="6" color="#38bdf8" below />
    </svg>
  )
}

/**
 * What VHS is and how to measure it, written for vets and non-vets (team, jury).
 * OK alone → shown again next time; ticked "don't show again" + OK → hidden for 30 days.
 */
export function VhsGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale()
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (open) setDontShow(false)
  }, [open])

  const finish = () => {
    rememberVhsGuideChoice(dontShow)
    onClose()
  }

  const steps = ['s1', 's2', 's3', 's4', 's5', 's6'] as const

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('vhs.guide.title')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-teal-600"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            {t('vhs.guide.dontShow', { days: VHS_GUIDE_SNOOZE_DAYS })}
          </label>
          <Button size="sm" onClick={finish} data-autofocus>
            {t('vhs.guide.ok')}
          </Button>
        </div>
      }
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm text-slate-700">
        <section>
          <h4 className="mb-1 font-semibold text-navy-900">{t('vhs.guide.whatTitle')}</h4>
          <p>{t('vhs.guide.what')}</p>
        </section>
        <section>
          <h4 className="mb-1 font-semibold text-navy-900">{t('vhs.guide.whyTitle')}</h4>
          <p>{t('vhs.guide.why')}</p>
        </section>
        <section>
          <h4 className="mb-2 font-semibold text-navy-900">{t('vhs.guide.howTitle')}</h4>
          <VhsDiagram title={t('vhs.guide.diagramAlt')} />
          <ol className="mt-3 space-y-1.5">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-2">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                    i < 2 ? 'bg-rose-400' : i < 4 ? 'bg-rose-300' : 'bg-sky-400'
                  }`}
                >
                  {i + 1}
                </span>
                <span>{t(`vhs.guide.${s}`)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>{t('vhs.guide.tips')}</p>
          <p className="mt-1">{t('vhs.guide.disclaimer')}</p>
        </section>
      </div>
    </Modal>
  )
}
