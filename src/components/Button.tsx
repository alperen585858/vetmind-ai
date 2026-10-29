import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'success'

const styles: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface-elevated text-navy-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  ghost: 'text-navy-700 hover:bg-slate-100',
  danger: 'bg-danger text-white hover:bg-rose-700 shadow-sm',
  warning: 'bg-warning text-white hover:bg-amber-600 shadow-sm',
  success: 'bg-success text-white hover:bg-emerald-700 shadow-sm',
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
