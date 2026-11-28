import {
  Columns2,
  Contrast,
  FlipHorizontal2,
  FlipVertical2,
  HeartPulse,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  RotateCw,
  Ruler,
  Square,
  Triangle,
  ZoomIn,
} from 'lucide-react'
import { useLocale } from '../../shell/LocaleContext'
import { PRESET_DEFS, ToolButton, type Tool } from './viewerParts'

export function ViewerToolbar({
  tool,
  onTool,
  annotateEnabled,
  vhsEnabled,
  onSelectVhs,
  invert,
  onToggleInvert,
  onRotate,
  flipH,
  onToggleFlipH,
  flipV,
  onToggleFlipV,
  onReset,
  cine,
  onToggleCine,
  cineFps,
  onCineFps,
  compare,
  onToggleCompare,
  fullscreen,
  onToggleFullscreen,
  onPreset,
  status,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  annotateEnabled: boolean
  vhsEnabled: boolean
  onSelectVhs: () => void
  invert: boolean
  onToggleInvert: () => void
  onRotate: () => void
  flipH: boolean
  onToggleFlipH: () => void
  flipV: boolean
  onToggleFlipV: () => void
  onReset: () => void
  cine: boolean
  onToggleCine: () => void
  cineFps: number
  onCineFps: (fps: number) => void
  compare: boolean
  onToggleCompare: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  onPreset: (id: string) => void
  status: string
}) {
  const { t } = useLocale()
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 bg-[#0b1727] px-2 py-1.5">
      <span className="mr-2 hidden text-[10px] font-semibold uppercase tracking-wider text-[#0D827B] sm:inline">
        Viewer
      </span>
      <ToolButton active={tool === 'wwwl'} title="Window / Level (W)" onClick={() => onTool('wwwl')}>
        <Contrast className="h-3.5 w-3.5" /> W/L
      </ToolButton>
      <ToolButton active={tool === 'pan'} title="Pan (P)" onClick={() => onTool('pan')}>
        <Move className="h-3.5 w-3.5" /> Pan
      </ToolButton>
      <ToolButton active={tool === 'zoom'} title="Zoom (Z)" onClick={() => onTool('zoom')}>
        <ZoomIn className="h-3.5 w-3.5" /> Zoom
      </ToolButton>
      <ToolButton active={tool === 'measure'} title="Mesafe (M)" onClick={() => onTool('measure')}>
        <Ruler className="h-3.5 w-3.5" /> Mesafe
      </ToolButton>
      <ToolButton active={tool === 'angle'} title="Açı (A)" onClick={() => onTool('angle')}>
        <Triangle className="h-3.5 w-3.5" /> Açı
      </ToolButton>
      <ToolButton active={tool === 'roi'} title="ROI (O)" onClick={() => onTool('roi')}>
        <Square className="h-3.5 w-3.5" /> ROI
      </ToolButton>
      {annotateEnabled ? (
        <ToolButton active={tool === 'annotate'} title="Anotasyon kutusu (B)" onClick={() => onTool('annotate')}>
          <PenLine className="h-3.5 w-3.5" /> BBox
        </ToolButton>
      ) : null}
      {vhsEnabled ? (
        <ToolButton active={tool === 'vhs'} title={`${t('vhs.toolTitle')} (H)`} onClick={onSelectVhs}>
          <HeartPulse className="h-3.5 w-3.5" /> VHS
        </ToolButton>
      ) : null}
      <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
      <ToolButton active={invert} title="Invert (I)" onClick={onToggleInvert}>
        Invert
      </ToolButton>
      <ToolButton title="90° döndür" onClick={onRotate}>
        <RotateCw className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton active={flipH} title="Yatay çevir" onClick={onToggleFlipH}>
        <FlipHorizontal2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton active={flipV} title="Dikey çevir" onClick={onToggleFlipV}>
        <FlipVertical2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton title="Reset (R)" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" /> Reset
      </ToolButton>
      <ToolButton active={cine} title="Cine (Space)" onClick={onToggleCine}>
        {cine ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Cine
      </ToolButton>
      {cine && (
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          fps
          <input
            type="number"
            min={1}
            max={30}
            value={cineFps}
            onChange={(e) => onCineFps(Math.max(1, Math.min(30, Number(e.target.value) || 8)))}
            className="w-10 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white"
          />
        </label>
      )}
      <ToolButton active={compare} title="Karşılaştır (C)" onClick={onToggleCompare}>
        <Columns2 className="h-3.5 w-3.5" /> Compare
      </ToolButton>
      <ToolButton title="Tam ekran (F)" onClick={onToggleFullscreen}>
        {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </ToolButton>
      <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
      {PRESET_DEFS.map((p) => (
        <button
          key={p.id}
          type="button"
          title={t(p.labelKey)}
          onClick={() => onPreset(p.id)}
          className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white"
        >
          {t(p.labelKey)}
        </button>
      ))}
      <span className="ml-auto max-w-[50%] truncate font-mono text-[10px] tabular-nums text-slate-400">{status}</span>
    </div>
  )
}
