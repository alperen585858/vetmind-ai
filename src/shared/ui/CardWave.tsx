/** Soft two-layer wave along the bottom of a pastel stat card. */
export function CardWave({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full" aria-hidden>
      <path d="M0 26 C40 10 70 34 110 22 C145 12 170 18 200 8 V40 H0 Z" fill={color} opacity="0.18" />
      <path d="M0 32 C45 20 80 38 120 28 C155 20 178 26 200 18 V40 H0 Z" fill={color} opacity="0.22" />
    </svg>
  )
}
