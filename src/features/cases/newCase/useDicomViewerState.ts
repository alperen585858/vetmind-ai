import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_VIEWER_FRAMES } from '../../../shared/lib/dicomFolder'
import { buildDicomPreviews, type DicomFramePreview } from '../../../shared/lib/dicomPreview'

type SeriesInstanceRef = { sopInstanceUid?: string; file?: File; seriesKey: string }

/** In-browser viewer state for the picked DICOM files (#79 moved upload into New Case). */
export function useDicomViewerState(dicomFiles: File[]) {
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [framesLoading, setFramesLoading] = useState(false)
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null)
  const [activeSopUid, setActiveSopUid] = useState<string | null>(null)
  const [focusSopUid, setFocusSopUid] = useState<string | null>(null)
  const [focusRequestId, setFocusRequestId] = useState(0)
  const viewerFiles = useMemo(() => dicomFiles.slice(0, MAX_VIEWER_FRAMES), [dicomFiles])

  useEffect(() => {
    let cancelled = false
    if (!viewerFiles.length) {
      setFrames([])
      setFramesLoading(false)
      return
    }
    setFramesLoading(true)
    void buildDicomPreviews(viewerFiles).then((next) => {
      if (!cancelled) {
        setFrames(next)
        setFramesLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [viewerFiles])

  const onActiveFrameChange = useCallback((frame: DicomFramePreview) => {
    if (frame.sopInstanceUid) setActiveSopUid(frame.sopInstanceUid)
    if (frame.seriesInstanceUid) setActiveSeriesKey(frame.seriesInstanceUid)
    else if (frame.seriesDescription) setActiveSeriesKey(`desc:${frame.seriesDescription}`)
    else setActiveSeriesKey(null)
  }, [])

  const selectInstance = useCallback((ref: SeriesInstanceRef) => {
    setActiveSeriesKey(ref.seriesKey)
    if (ref.sopInstanceUid) {
      setActiveSopUid(ref.sopInstanceUid)
      setFocusSopUid(ref.sopInstanceUid)
      setFocusRequestId((n) => n + 1)
    }
  }, [])

  const resetSelection = useCallback(() => {
    setActiveSeriesKey(null)
    setActiveSopUid(null)
  }, [])

  return {
    frames,
    framesLoading,
    activeSeriesKey,
    activeSopUid,
    focusSopUid,
    focusRequestId,
    onActiveFrameChange,
    selectInstance,
    resetSelection,
  }
}

export type DicomViewerState = ReturnType<typeof useDicomViewerState>
