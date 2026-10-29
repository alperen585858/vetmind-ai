/** Flat green circle + white check — matches the success icon reference. */

export function PaymentSuccessCheck({ label = 'Onaylandı' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-2 text-center" role="status" aria-live="polite">
      <div className="relative flex h-40 w-40 items-center justify-center animate-pay-pop">
        {/* Solid green circle */}
        <div
          className="flex h-36 w-36 items-center justify-center rounded-full"
          style={{ backgroundColor: '#22C55E' }}
        >
          {/* Thick white check with squared ends */}
          <svg viewBox="0 0 64 64" className="h-[4.25rem] w-[4.25rem]" fill="none" aria-hidden>
            <path
              className="animate-pay-check"
              d="M14 34 L26 46 L50 18"
              stroke="#FFFFFF"
              strokeWidth="8"
              strokeLinecap="square"
              strokeLinejoin="miter"
              strokeDasharray={72}
              strokeDashoffset={72}
            />
          </svg>
        </div>
      </div>

      <p className="mt-5 text-2xl font-semibold tracking-tight text-navy-900 animate-fade-up">
        {label}
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-slate-600 animate-fade-up [animation-delay:120ms]">
        Ödeme onaylandı
      </p>
    </div>
  )
}
