import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'success'

const styles: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_16px_rgba(11,128,122,0.28)] hover:bg-accent-hover hover:shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_8px_20px_rgba(11,128,122,0.34)]',
  secondary:
    'bg-white/90 text-navy-800 ring-1 ring-inset ring-slate-300/90 shadow-sm hover:bg-slate-50 hover:ring-slate-400/70',
  ghost: 'text-navy-700 hover:bg-slate-100/90',
  danger: 'bg-danger text-white shadow-sm hover:bg-rose-700',
  warning: 'bg-warning text-white shadow-sm hover:bg-amber-600',
  success: 'bg-success text-white shadow-sm hover:bg-emerald-700',
}

export function Button({
  variant = 'primary',
  icon,
  children,
  className = '',
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  // md/lg meet ≥44px touch target on critical CTAs
  const sizes = {
    sm: 'min-h-9 px-2.5 py-1.5 text-xs',
    md: 'min-h-11 px-3.5 py-2 text-sm',
    lg: 'min-h-12 px-5 py-2.5 text-[15px]',
  }
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-vm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${styles[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}
