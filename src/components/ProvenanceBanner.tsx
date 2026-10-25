import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'

export type ProvenanceKind = 'mock' | 'synthetic' | 'mixed' | 'real' | 'not_configured' | 'unknown'

const META: Record<
  ProvenanceKind,
  { label: string; cls: string; icon: 'warn' | 'info' | 'shield'; text: string }
> = {
  mock: {
    label: 'DEMO',
    cls: 'border-amber-300 bg-amber-50 text-amber-950',
    icon: 'warn',
    text: 'Demo çıktı. Klinik tanı veya sertifikasyon iddiası yoktur.',
  },
  synthetic: {
    label: 'SENTETİK',
    cls: 'border-orange-300 bg-orange-50 text-orange-950',
    icon: 'warn',
    text: 'Sentetik / simüle edilmiş veri. Gerçek hasta bulgusu değildir.',
  },
  mixed: {
    label: 'KARMA',
    cls: 'border-violet-300 bg-violet-50 text-violet-950',
    icon: 'shield',
    text: 'Demo ve gerçek kaynaklar karışık olabilir. Uzman incelemesi zorunludur.',
  },
  real: {
    label: 'GERÇEK MODEL',
    cls: 'border-sky-300 bg-sky-50 text-sky-950',
    icon: 'info',
    text: 'Gerçek model yolu. Klinik doğrulama değildir; uzman onayı gerekir.',
  },
  not_configured: {
    label: 'BAĞLI DEĞİL',
    cls: 'border-slate-300 bg-slate-100 text-slate-800',
    icon: 'shield',
    text: 'Gerçek Vision / LLM bağlı değil. Bulgu uydurulmaz; entegrasyon bekleniyor.',
  },
  unknown: {
    label: 'BİLİNMİYOR',
    cls: 'border-slate-200 bg-slate-50 text-slate-700',
    icon: 'info',
    text: 'Kaynak bilgisi yok. Klinik kullanım için uygun değildir.',
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
            {m.label}
          </span>
          {m.text}
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
