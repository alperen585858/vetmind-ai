import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Layers, Trash2 } from 'lucide-react'
import type { DicomFramePreview } from '../lib/dicomPreview'
import { displayPath } from '../lib/dicomFolder'
import type { DicomStudyMeta } from '../types'

export type SeriesItem = {
  key: string
  seriesDescription?: string
  modality?: string
  seriesInstanceUid?: string
  bodyPart?: string
  instances: {
    id: string
    label: string
    file?: File
    sopInstanceUid?: string
    hasPixelPreview?: boolean
  }[]
}

function seriesKeyFromFrame(f: DicomFramePreview): string {
  if (f.seriesInstanceUid) return f.seriesInstanceUid
  if (f.seriesDescription) return `desc:${f.seriesDescription}`
  return 'ungrouped'
}

/** Build Study → Series → Instances from backend study meta and/or client frames. Never invents missing tags. */
export function buildSeriesItems(
  files: File[],
  frames: DicomFramePreview[],
  study: DicomStudyMeta | null | undefined,
): { studyDescription?: string; studyUid?: string; series: SeriesItem[] } {
  if (study?.series?.length) {
    const fileByName = new Map(files.map((f) => [f.name, f]))
    const fileByPath = new Map(files.map((f) => [displayPath(f), f]))
    const frameBySop = new Map(
      frames.filter((f) => f.sopInstanceUid).map((f) => [f.sopInstanceUid!, f]),
    )
    const series: SeriesItem[] = study.series.map((s, idx) => {
      const instances = s.instances.map((inst, i) => {
        const file =
          (inst.filename ? fileByName.get(inst.filename) || fileByPath.get(inst.filename) : undefined) ??
          undefined
        const frame = inst.sop_instance_uid ? frameBySop.get(inst.sop_instance_uid) : undefined
        return {
          id: inst.sop_instance_uid || `${s.series_instance_uid}-${i}`,
          label: inst.filename || inst.sop_instance_uid || `Instance ${i + 1}`,
          file,
          sopInstanceUid: inst.sop_instance_uid || undefined,
          hasPixelPreview: Boolean(frame?.ok && frame.pixels),
        }
      })
      return {
        key: s.series_instance_uid || `series-${idx}`,
        seriesDescription: s.series_description ?? undefined,
        modality: s.modality ?? undefined,
        seriesInstanceUid: s.series_instance_uid || undefined,
        bodyPart: s.body_part_examined ?? undefined,
        instances,
      }
    })
    return {
      studyDescription: study.study_description ?? undefined,
      studyUid: study.study_instance_uid || undefined,
      series,
    }
  }

  // Client-side grouping from decoded frames + leftover files (no fabricated UIDs/descriptions)
  const bySeries = new Map<string, SeriesItem>()
  const matchedFiles = new Set<File>()

  frames.forEach((f, i) => {
    const key = seriesKeyFromFrame(f)
    let group = bySeries.get(key)
    if (!group) {
      group = {
        key,
        seriesDescription: f.seriesDescription,
        modality: f.modality,
        seriesInstanceUid: f.seriesInstanceUid,
        instances: [],
      }
      bySeries.set(key, group)
    }
    const file = files.find(
      (x) =>
        x.name === f.fileName ||
        displayPath(x) === f.relativePath ||
        displayPath(x) === f.fileName,
    )
    if (file) matchedFiles.add(file)
    group.instances.push({
      id: f.sopInstanceUid || `${f.fileName}-${i}`,
      label: f.relativePath || f.fileName,
      file,
      sopInstanceUid: f.sopInstanceUid,
      hasPixelPreview: Boolean(f.ok && f.pixels),
    })
  })

  const leftovers = files.filter((f) => !matchedFiles.has(f))
  if (leftovers.length) {
    bySeries.set('files-only', {
      key: 'files-only',
      seriesDescription: bySeries.size ? 'Diğer dosyalar' : undefined,
      instances: leftovers.map((file, i) => ({
        id: `file-${displayPath(file)}-${i}`,
        label: displayPath(file),
        file,
        hasPixelPreview: false,
      })),
    })
  }

  // If no frames yet but files exist, list as flat file group
  if (!bySeries.size && files.length) {
    bySeries.set('pending', {
      key: 'pending',
      instances: files.map((file, i) => ({
        id: `pending-${displayPath(file)}-${i}`,
        label: displayPath(file),
        file,
        hasPixelPreview: false,
      })),
    })
  }

  const studyDescription = frames.find((f) => f.studyDescription)?.studyDescription
  return { studyDescription, series: Array.from(bySeries.values()) }
}

export function SeriesExplorer({
  files,
  frames,
  study,
  activeSeriesKey,
  activeSopUid,
  onRemoveFile,
  onClearAll,
  onSelectInstance,
  className = '',
}: {
  files: File[]
  frames: DicomFramePreview[]
  study?: DicomStudyMeta | null
  activeSeriesKey?: string | null
  activeSopUid?: string | null
  onRemoveFile: (file: File) => void
  onClearAll?: () => void
  /** Jump viewer to this instance (SOP UID and/or file). Does not invent metadata. */
  onSelectInstance?: (ref: { sopInstanceUid?: string; file?: File; seriesKey: string }) => void
  className?: string
}) {
  const tree = useMemo(() => buildSeriesItems(files, frames, study), [files, frames, study])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (!files.length && !tree.series.length) return null

  const totalImages = tree.series.reduce((n, s) => n + s.instances.length, 0)

  return (
    <div className={`rounded-xl border border-[#E3EAF0] bg-white ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#E3EAF0] px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#172B45]">
            <Layers className="h-3.5 w-3.5 text-[#0D827B]" />
            Study / Series
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {tree.studyDescription || 'Study'}
            {tree.studyUid ? ` · ${tree.series.length} seri · ${totalImages} görüntü` : ` · ${totalImages} dosya`}
          </p>
        </div>
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-rose-600"
          >
            Temizle
          </button>
        )}
      </div>

      <ul className="max-h-56 overflow-y-auto divide-y divide-[#E3EAF0]">
        {tree.series.map((series) => {
          const isActive =
            activeSeriesKey != null &&
            (series.key === activeSeriesKey ||
              series.seriesInstanceUid === activeSeriesKey ||
              (series.seriesDescription != null && `desc:${series.seriesDescription}` === activeSeriesKey))
          const isOpen = expanded[series.key] ?? (isActive || tree.series.length === 1)
          return (
            <li key={series.key}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                  isActive ? 'bg-teal-50/70' : ''
                }`}
                onClick={() => setExpanded((prev) => ({ ...prev, [series.key]: !isOpen }))}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#172B45]">
                    {series.seriesDescription ||
                      (series.seriesInstanceUid
                        ? `Series ${series.seriesInstanceUid.slice(-8)}`
                        : 'Series')}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {[series.modality, `${series.instances.length} görüntü`, series.bodyPart]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {isActive && (
                  <span className="shrink-0 rounded bg-[#0D827B]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#0D827B]">
                    Aktif
                  </span>
                )}
              </button>
              {isOpen && (
                <ul className="border-t border-[#E3EAF0] bg-[#F4F7FA]/80">
                  {series.instances.map((inst) => {
                    const isInstActive =
                      (activeSopUid != null &&
                        inst.sopInstanceUid != null &&
                        inst.sopInstanceUid === activeSopUid) ||
                      false
                    return (
                      <li
                        key={inst.id}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 pl-9 ${
                          isInstActive ? 'bg-teal-50/80' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[#0D827B]"
                          title="Görüntüleyicide aç"
                          onClick={() =>
                            onSelectInstance?.({
                              sopInstanceUid: inst.sopInstanceUid,
                              file: inst.file,
                              seriesKey: series.key,
                            })
                          }
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate text-[12px] text-[#172B45]" title={inst.label}>
                            {inst.label}
                          </span>
                          {!inst.hasPixelPreview && (
                            <span className="shrink-0 text-[10px] text-slate-400">meta</span>
                          )}
                        </button>
                        {inst.file && (
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Kaldır"
                            aria-label={`${inst.label} kaldır`}
                            onClick={() => onRemoveFile(inst.file!)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
