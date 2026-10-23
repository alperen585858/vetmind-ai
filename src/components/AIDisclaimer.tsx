import { AlertTriangle } from 'lucide-react'

export function AIDisclaimer({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
      } text-amber-900 ${className}`}
    >
      <AlertTriangle className={`mt-0.5 shrink-0 text-amber-600 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
      <p>
        <strong>Bu bir yapay zekâ ön değerlendirmesidir.</strong> Kesin tanı değildir; uzman veteriner hekim onayı gerektirir.
      </p>
    </div>
  )
}
