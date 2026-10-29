export function Logo({
  dark = false,
  size = 'md',
  accent = 'teal',
}: {
  dark?: boolean
  size?: 'md' | 'lg'
  accent?: 'teal' | 'sky' | 'navy'
}) {
  const box = size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  const text = size === 'lg' ? 'text-2xl' : 'text-lg'
  const mark =
    accent === 'sky'
      ? 'bg-gradient-to-br from-sky-300 via-sky-500 to-navy-800'
      : accent === 'navy'
        ? 'bg-gradient-to-br from-navy-400 to-navy-800'
        : 'bg-gradient-to-br from-teal-400 to-teal-700'
  const ai = accent === 'sky' ? 'text-sky-400' : accent === 'navy' ? 'text-navy-300' : 'text-teal-400'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${box} flex items-center justify-center rounded-xl ${mark} shadow-sm`}>
        <svg viewBox="0 0 32 32" className="h-3/5 w-3/5" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17h6l3-7 5 13 3-6h7" />
        </svg>
      </div>
      <span className={`${text} font-bold tracking-tight ${dark ? 'text-white' : 'text-navy-900'}`}>
        VetMind <span className={ai}>AI</span>
      </span>
    </div>
  )
}
