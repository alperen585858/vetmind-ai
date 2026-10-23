import { ProvenanceBanner } from './ProvenanceBanner'

/** Human-in-the-loop disclaimer — wraps shared provenance styling. */
export function AIDisclaimer({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return <ProvenanceBanner kind="mock" compact={compact} className={className} />
}
