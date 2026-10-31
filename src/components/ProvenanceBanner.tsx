import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'

export type ProvenanceKind = 'mock' | 'synthetic' | 'mixed' | 'real' | 'not_configured' | 'unknown'

type ProvMeta = { labelKey: string; textKey: string; cls: string; icon: 'warn' | 'info' | 'shield' }

const META: Record<ProvenanceKind, ProvMeta> = {
  mock: {
    labelKey: 'ai.provMockLabel',
    textKey: 'ai.provMockText',
    cls: 'border-amber-300 bg-amber-50 text-amber-950',
    icon: 'warn',
  },
  synthetic: {
    labelKey: 'ai.provSyntheticLabel',
    textKey: 'ai.provSyntheticText',
    cls: 'border-orange-300 bg-orange-50 text-orange-950',
    icon: 'warn',
  },
  mixed: {
    labelKey: 'ai.provMixedLabel',
    textKey: 'ai.provMixedText',
    cls: 'border-violet-300 bg-violet-50 text-violet-950',
    icon: 'shield',
  },
  real: {
    labelKey: 'ai.provRealLabel',
    textKey: 'ai.provRealText',
    cls: 'border-sky-300 bg-sky-50 text-sky-950',
    icon: 'info',
  },
  not_configured: {
    labelKey: 'ai.provNotConfiguredLabel',
    textKey: 'ai.provNotConfiguredText',
    cls: 'border-slate-300 bg-slate-100 text-slate-800',
    icon: 'shield',
  },
  unknown: {
    labelKey: 'ai.provUnknownLabel',
    textKey: 'ai.provUnknownText',
    cls: 'border-slate-200 bg-slate-50 text-slate-700',
    icon: 'info',
  },
}

/** Shared MOCK / SYNTHETIC / REAL / NOT CONFIGURED banner for AI transparency. */
export function ProvenanceBanner({
  kind,
  detail,
  className = '',
  compact = false,
}: {
  kind: ProvenanceKind
  detail?: string
  className?: string
  compact?: boolean
}) {
  const { t } = useLocale()
  const m = META[kind] ?? META.unknown
  const Icon = m.icon === 'warn' ? AlertTriangle : m.icon === 'shield' ? ShieldAlert : Info
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border ${m.cls} ${
        compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
      } ${className}`}
    >
      <Icon className={`mt-0.5 shrink-0 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} aria-hidden />
      <div className="min-w-0">
        <p>
          <span className="mr-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ring-current/20">
            {t(m.labelKey)}
          </span>
          {t(m.textKey)}
        </p>
        {detail ? <p className="mt-1 text-[11px] opacity-80">{detail}</p> : null}
      </div>
    </div>
  )
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
