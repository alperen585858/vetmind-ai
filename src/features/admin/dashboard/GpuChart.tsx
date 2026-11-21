import { useLocale } from '../../../shared/shell/LocaleContext'

/** Placeholder — synthetic GPU curves were removed to avoid implying live telemetry. */
export function GpuChart({ height = 180 }: { height?: number }) {
  const { t } = useLocale()
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-amber-200 bg-amber-50/40 px-4 text-center"
      style={{ height }}
    >
      <p className="text-sm font-medium text-amber-950">{t('dashboard.gpuTelemetryUnavailable')}</p>
      <p className="mt-1 text-xs text-amber-800/80">{t('dashboard.gpuTelemetryHint')}</p>
    </div>
  )
}
