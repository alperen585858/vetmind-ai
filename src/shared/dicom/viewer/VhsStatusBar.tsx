import { HeartPulse, Undo2 } from 'lucide-react'
import { useLocale } from '../../shell/LocaleContext'
import { VHS_POINT_COUNT, VHS_STEP_KEYS, type VhsResult } from '../../lib/vhs'

/** VHS progress (next point to place) or the finished score, with undo / clear / add to report. */
export function VhsStatusBar({
  result,
  pointCount,
  onHelp,
  onUndo,
  onClear,
  onCommit,
}: {
  result: VhsResult | null
  pointCount: number
  onHelp: () => void
  onUndo: () => void
  onClear: () => void
  onCommit?: (result: VhsResult) => void
}) {
  const { t } = useLocale()
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0b1727] px-3 py-1.5 text-[11px] text-slate-200"
      role="status"
      aria-live="polite"
    >
      <HeartPulse className="h-3.5 w-3.5 text-rose-300" aria-hidden />
      {result ? (
        <span>
          <strong className="text-white">VHS {result.vhs.toFixed(1)} v</strong>
          {' · '}
          {t(`vhs.category.${result.category}`)}
          {result.reference ? ` (${t('vhs.reference', { min: result.reference.min, max: result.reference.max })})` : ''}
          {` · ${t('vhs.axes', { long: result.longV.toFixed(1), short: result.shortV.toFixed(1) })}`}
          {result.notPerpendicular ? (
            <span className="ml-1 text-amber-300">· {t('vhs.notPerpendicular', { deg: result.axisAngleDeg })}</span>
          ) : null}
        </span>
      ) : (
        <span>
          <span className="font-mono text-rose-200">
            {Math.min(pointCount + 1, VHS_POINT_COUNT)}/{VHS_POINT_COUNT}
          </span>{' '}
          {t(`vhs.step.${VHS_STEP_KEYS[Math.min(pointCount, VHS_POINT_COUNT - 1)]}`)}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-white/20 font-bold text-slate-200 hover:bg-white/10"
          title={t('vhs.guide.help')}
          aria-label={t('vhs.guide.help')}
          onClick={onHelp}
        >
          ?
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 disabled:opacity-40"
          disabled={!pointCount}
          onClick={onUndo}
        >
          <Undo2 className="h-3 w-3" aria-hidden /> {t('vhs.undo')}
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 disabled:opacity-40"
          disabled={!pointCount}
          onClick={onClear}
        >
          {t('vhs.clear')}
        </button>
        {result && onCommit ? (
          <button
            type="button"
            className="rounded bg-[#0D827B] px-2 py-0.5 font-semibold text-white hover:bg-[#0b6f69]"
            onClick={() => onCommit(result)}
          >
            {t('vhs.addToReport')}
          </button>
        ) : null}
      </span>
    </div>
  )
}
