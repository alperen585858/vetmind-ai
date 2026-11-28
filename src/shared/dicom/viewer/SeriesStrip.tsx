import { useLocale } from '../../shell/LocaleContext'
import { modalityLabel } from '../../lib/displayClean'
import type { groupFramesBySeries } from '../../lib/dicomPreview'

export type SeriesGroup = ReturnType<typeof groupFramesBySeries>[number]

/** Series picker shown above the viewer when a study has more than one series. */
export function SeriesStrip({
  groups,
  activeKey,
  onSelect,
}: {
  groups: SeriesGroup[]
  activeKey: string | undefined
  onSelect: (key: string) => void
}) {
  const { t } = useLocale()
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 bg-[#0b1727] px-2 py-1.5">
      {groups.map((s) => (
        <button
          key={s.key}
          type="button"
          title={s.label}
          onClick={() => onSelect(s.key)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] ${
            s.key === activeKey ? 'bg-[#0D827B] text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          {s.thumbUrl ? (
            <img src={s.thumbUrl} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-[9px] text-slate-500">
              {s.frames.length}
            </span>
          )}
          <span className="max-w-[100px] truncate">
            {s.modality ? `${modalityLabel(t, s.modality)} · ` : ''}
            {s.label}
          </span>
          <span className="text-slate-400">({s.frames.length})</span>
        </button>
      ))}
    </div>
  )
}
