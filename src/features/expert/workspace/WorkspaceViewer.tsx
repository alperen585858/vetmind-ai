import { ChevronDown, ImageOff, Keyboard } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Button } from '../../../shared/ui/Button'
import { DicomViewer } from '../../../shared/dicom/DicomViewer'
import type { DicomFramePreview } from '../../../shared/lib/dicomPreview'
import type { VhsResult } from '../../../shared/lib/vhs'
import type { ComponentProps } from 'react'

type ViewerProps = ComponentProps<typeof DicomViewer>

/** Left column of the workspace: overlay toggle, DICOM viewer, shortcut help (or "no images"). */
export function WorkspaceViewer({
  error,
  frames,
  loadingFrames,
  overlaysVisible,
  onToggleOverlays,
  overlays,
  focusSopUid,
  focusRequestId,
  onActiveFrameChange,
  vhsEnabled,
  vhsSpecies,
  onVhsCommit,
  annotateEnabled,
  selectedEvidenceId,
  onAnnotateCommit,
}: {
  error: string | null
  frames: DicomFramePreview[]
  loadingFrames: boolean
  overlaysVisible: boolean
  onToggleOverlays: () => void
  overlays: NonNullable<ViewerProps['overlays']>
  focusSopUid: string | null | undefined
  focusRequestId: number
  onActiveFrameChange: (frame: DicomFramePreview) => void
  vhsEnabled: boolean
  vhsSpecies: ViewerProps['vhsSpecies']
  onVhsCommit?: (r: VhsResult) => void
  annotateEnabled: boolean
  selectedEvidenceId: string | null
  onAnnotateCommit: ViewerProps['onAnnotateCommit']
}) {
  const { t } = useLocale()
  return (
    <div className="min-h-[420px] space-y-3 xl:min-h-[560px] xl:sticky xl:top-20 xl:self-start">
      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
          {error}
        </p>
      )}
      {!loadingFrames && frames.length === 0 ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-b from-slate-900 to-[#102a43] px-6 text-center xl:min-h-[560px]">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-slate-300 ring-1 ring-white/15">
            <ImageOff className="h-7 w-7" aria-hidden />
          </span>
          <p className="font-display text-base font-semibold text-white">{t('review.workspace.noImagesTitle')}</p>
          <p className="max-w-xs text-sm text-slate-400">{t('review.workspace.noImagesText')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" aria-pressed={overlaysVisible} onClick={onToggleOverlays}>
              {overlaysVisible ? t('review.overlayOn') : t('review.overlayOff')}
            </Button>
            <span className="text-[11px] text-slate-500">
              {overlaysVisible ? t('review.overlayBoxes', { count: overlays.length }) : t('review.overlayHidden')}
            </span>
          </div>
          <DicomViewer
            frames={frames}
            loading={loadingFrames}
            className="min-h-[420px] xl:min-h-[560px]"
            focusSopUid={focusSopUid}
            focusRequestId={focusRequestId}
            overlays={overlays}
            onActiveFrameChange={onActiveFrameChange}
            vhsEnabled={vhsEnabled}
            vhsSpecies={vhsSpecies}
            onVhsCommit={onVhsCommit}
            annotateEnabled={annotateEnabled}
            selectedEvidenceId={selectedEvidenceId}
            onAnnotateCommit={onAnnotateCommit}
          />
          <details className="group text-[11px] text-slate-500">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 font-semibold text-slate-600 marker:hidden hover:bg-slate-100">
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              {t('review.workspace.shortcutsTitle')}
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-1 px-1.5 leading-relaxed">{t('review.workspace.shortcutsHelp')}</p>
          </details>
        </>
      )}
    </div>
  )
}
