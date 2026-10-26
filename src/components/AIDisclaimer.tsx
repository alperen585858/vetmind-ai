import type * as React from 'react'
import { AlertTriangle } from 'lucide-react'

interface AIDisclaimerProps {
  className?: string
  compact?: boolean
}

export const AIDisclaimer: React.FC<AIDisclaimerProps> = ({ className = '', compact = false }) => (
  <div
    role="note"
    className={`flex items-start gap-3 rounded-r-lg border-l-4 border-vet-amber bg-vet-amber/10 text-slate-800 ${
      compact ? 'p-3 text-sm' : 'p-4'
    } ${className}`}
  >
    <AlertTriangle
      aria-hidden="true"
      className={`mt-0.5 shrink-0 text-vet-amber ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}
    />
    <div>
      <p className="font-semibold">Klinik Uyarı</p>
      <p className="mt-1">
        Bu bir yapay zeka (MOCK/SYNTHETIC) ön değerlendirmesidir. Klinik tanı olarak kullanılamaz,
        mutlaka uzman veteriner radyolog onayı gerektirir.
      </p>
    </div>
  </div>
)
