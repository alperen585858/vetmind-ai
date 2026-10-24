/** Live visual preview for the demo payment card (generic styling — not a real brand). */

function formatPreviewNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16)
  const padded = (digits + '••••••••••••••••').slice(0, 16)
  return `${padded.slice(0, 4)} ${padded.slice(4, 8)} ${padded.slice(8, 12)} ${padded.slice(12, 16)}`
}

function formatPreviewExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (!digits) return 'MM/YY'
  const mm = (digits.slice(0, 2) + '••').slice(0, 2)
  const yy = (digits.slice(2, 4) + '••').slice(0, 2)
  return `${mm}/${yy}`
}

export interface PaymentCardPreviewProps {
  cardNumber: string
  cardholderName: string
  expiry: string
  /** Visual emphasis when form is submitting */
  pulsing?: boolean
}

export function PaymentCardPreview({
  cardNumber,
  cardholderName,
  expiry,
  pulsing = false,
}: PaymentCardPreviewProps) {
  const name = cardholderName.trim() || 'DEMO CARDHOLDER'
  const number = formatPreviewNumber(cardNumber)
  const exp = formatPreviewExpiry(expiry)

  return (
    <div className={`relative mx-auto w-full max-w-[360px] ${pulsing ? 'animate-pulse' : ''}`}>
      {/* Soft glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-[1.75rem] bg-gradient-to-br from-teal-400/25 via-navy-500/15 to-slate-400/10 blur-xl"
      />

      <div
        className="relative aspect-[1.586/1] overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-navy-900/25 ring-1 ring-white/20"
        style={{
          background:
            'linear-gradient(135deg, #0b1f3a 0%, #163a5f 42%, #0f766e 78%, #134e4a 100%)',
        }}
      >
        {/* Decorative sheen */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 left-8 h-32 w-48 rounded-full bg-teal-300/20 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-25deg, transparent, transparent 12px, rgba(255,255,255,0.35) 12px, rgba(255,255,255,0.35) 13px)',
          }}
        />

        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            {/* Generic EMV-style chip */}
            <div
              className="h-9 w-12 rounded-md border border-amber-200/40 bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner"
              aria-hidden
            >
              <div className="mt-1.5 grid grid-cols-3 gap-px px-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-1.5 rounded-[1px] bg-amber-700/25" />
                ))}
              </div>
            </div>
            <span className="rounded-full border border-white/30 bg-white/15 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-white backdrop-blur-sm">
              DEMO CARD
            </span>
          </div>

          <p className="mt-4 font-mono text-[1.15rem] tracking-[0.18em] text-white drop-shadow-sm sm:text-[1.25rem]">
            {number}
          </p>

          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <div className="min-w-0">
              <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/55">Cardholder</p>
              <p className="truncate text-sm font-semibold uppercase tracking-wide text-white">{name}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/55">Expires</p>
              <p className="font-mono text-sm font-semibold tracking-wider text-white">{exp}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-slate-500">
        Canlı önizleme · marka logosu değildir · gerçek tahsilat yok
      </p>
    </div>
  )
}
