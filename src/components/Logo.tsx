export function Logo({ dark = false, size = 'md' }: { dark?: boolean; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  const text = size === 'lg' ? 'text-2xl' : 'text-lg'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${box} flex items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 shadow-sm`}>
        <svg viewBox="0 0 32 32" className="h-3/5 w-3/5" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17h6l3-7 5 13 3-6h7" />
        </svg>
      </div>
      <span className={`${text} font-bold tracking-tight ${dark ? 'text-white' : 'text-navy-900'}`}>
        VetMind <span className="text-teal-400">AI</span>
      </span>
    </div>
  )
}
