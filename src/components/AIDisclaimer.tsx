import { AlertTriangle } from 'lucide-react'

export function AIDisclaimer({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        <strong>Bu bir yapay zekâ ön değerlendirmesidir.</strong> Kesin tanı değildir; uzman veteriner hekim onayı gerektirir.
      </p>
    </div>
  )
}
