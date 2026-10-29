export type ProvenanceKind = 'mock' | 'synthetic' | 'mixed' | 'real' | 'not_configured' | 'unknown'

/** Hidden — provenance disclaimer banners removed from product UI. */
export function ProvenanceBanner(_props: {
  kind: ProvenanceKind
  detail?: string
  className?: string
  compact?: boolean
}) {
  return null
}

export function provenanceKindFromSource(
  sourceKind?: string | null,
  opts?: { synthetic?: boolean | null; analysisMode?: string | null },
): ProvenanceKind {
  const mode = (opts?.analysisMode || '').toLowerCase()
  if (mode === 'not_configured' || mode === 'unavailable') return 'not_configured'
  const sk = (sourceKind || '').toLowerCase()
  if (sk === 'real') return 'real'
  if (sk === 'mixed') return 'mixed'
  if (opts?.synthetic || sk === 'synthetic') return sk === 'mock' ? 'mock' : 'synthetic'
  if (sk === 'mock') return 'mock'
  if (!sk && mode !== 'real' && mode !== 'mixed') return 'not_configured'
  return 'unknown'
}
