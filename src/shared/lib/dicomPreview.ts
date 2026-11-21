/**
 * Client-side DICOM decode for radiologist viewing.
 * Keeps float pixels so window/level can be adjusted live.
 * NOT pixel-based AI diagnosis. Not clinical/PACS-grade validation.
 */

import { parseDicom } from 'dicom-parser'

export interface DicomFramePreview {
  fileName: string
  relativePath?: string
  ok: boolean
  error?: string
  modality?: string
  rows?: number
  cols?: number
  studyDescription?: string
  seriesDescription?: string
  seriesInstanceUid?: string
  studyInstanceUid?: string
  sopInstanceUid?: string
  instanceNumber?: number
  photometric?: string
  /** Rescale slope/intercept applied float pixels (rows*cols). */
  pixels?: Float32Array
  pixelMin?: number
  pixelMax?: number
  /** Default window from DICOM tags when present. */
  defaultWindowCenter?: number
  defaultWindowWidth?: number
  /** Row/col spacing in mm when PixelSpacing present (calibrated measure). */
  pixelSpacingMm?: [number, number]
  /** Image Position Patient (x,y,z) when present — used for spatial slice sort. */
  imagePositionPatient?: [number, number, number]
  /** Slice Location tag when present (fallback axis). */
  sliceLocation?: number
  /** Cached thumbnail data URL (auto window). */
  thumbUrl?: string
  /** Transfer syntax UID when readable (unsupported syntax → ok:false). */
  transferSyntaxUid?: string
}

function tag(ds: ReturnType<typeof parseDicom>, name: string): string | undefined {
  return ds.string(name)?.trim() || undefined
}

function firstNumber(ds: ReturnType<typeof parseDicom>, name: string): number | undefined {
  const raw = ds.string(name)
  if (!raw) return undefined
  const first = raw.split('\\')[0]
  const n = Number(first)
  return Number.isFinite(n) ? n : undefined
}

function parseFloatTriplet(raw: string | undefined): [number, number, number] | undefined {
  if (!raw) return undefined
  const parts = raw.split('\\').map((p) => Number(p.trim()))
  if (parts.length < 3) return undefined
  if (!parts.slice(0, 3).every((n) => Number.isFinite(n))) return undefined
  return [parts[0]!, parts[1]!, parts[2]!]
}

/** Spatial / instance sort key — never invents positions; falls back to InstanceNumber then filename. */
export function frameSortKey(f: DicomFramePreview): [number, number, number, number, string] {
  if (f.imagePositionPatient) {
    const [x, y, z] = f.imagePositionPatient
    return [0, z, y, x, f.sopInstanceUid || f.fileName]
  }
  if (f.sliceLocation != null && Number.isFinite(f.sliceLocation)) {
    return [1, f.sliceLocation, 0, 0, f.sopInstanceUid || f.fileName]
  }
  if (f.instanceNumber != null) {
    return [2, f.instanceNumber, 0, 0, f.sopInstanceUid || f.fileName]
  }
  return [3, 0, 0, 0, f.fileName]
}

export function sortFramesSpatially(frames: DicomFramePreview[]): DicomFramePreview[] {
  return [...frames].sort((a, b) => {
    const ka = frameSortKey(a)
    const kb = frameSortKey(b)
    for (let i = 0; i < 4; i++) {
      if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number)
    }
    return String(ka[4]).localeCompare(String(kb[4]))
  })
}

export function seriesKeyOf(f: DicomFramePreview): string {
  return f.seriesInstanceUid || (f.seriesDescription ? `desc:${f.seriesDescription}` : 'ungrouped')
}

export function groupFramesBySeries(frames: DicomFramePreview[]): {
  key: string
  label: string
  modality?: string
  frames: DicomFramePreview[]
  thumbUrl?: string
}[] {
  const map = new Map<string, DicomFramePreview[]>()
  for (const f of frames) {
    const key = seriesKeyOf(f)
    const list = map.get(key) || []
    list.push(f)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, list]) => {
    const sorted = sortFramesSpatially(list)
    const first = sorted.find((x) => x.ok) || sorted[0]
    return {
      key,
      label: first?.seriesDescription || key.slice(0, 12),
      modality: first?.modality,
      frames: sorted,
      thumbUrl: first?.thumbUrl,
    }
  })
}

export function renderFrameToCanvas(
  canvas: HTMLCanvasElement,
  frame: DicomFramePreview,
  opts: { windowCenter: number; windowWidth: number; invert?: boolean },
): void {
  if (!frame.ok || !frame.pixels || !frame.rows || !frame.cols) return
  const { rows, cols, pixels, photometric } = frame
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const ww = Math.max(1, opts.windowWidth)
  const wc = opts.windowCenter
  const lo = wc - ww / 2
  const hi = wc + ww / 2
  const invert = Boolean(opts.invert) || photometric === 'MONOCHROME1'
  const image = ctx.createImageData(cols, rows)

  for (let i = 0; i < pixels.length; i++) {
    let g = ((pixels[i] - lo) / (hi - lo)) * 255
    g = Math.max(0, Math.min(255, g))
    if (invert) g = 255 - g
    const o = i < pixels.length ? i * 4 : 0
    image.data[o] = g
    image.data[o + 1] = g
    image.data[o + 2] = g
    image.data[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
}

/** ROI mean/min/max over pixel values (display units after rescale). Bounds clamped to image. */
export function roiStats(
  frame: DicomFramePreview,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { mean: number; min: number; max: number; count: number } | null {
  if (!frame.ok || !frame.pixels || !frame.rows || !frame.cols) return null
  const left = Math.max(0, Math.min(Math.floor(x0), Math.floor(x1)))
  const right = Math.min(frame.cols - 1, Math.max(Math.floor(x0), Math.floor(x1)))
  const top = Math.max(0, Math.min(Math.floor(y0), Math.floor(y1)))
  const bottom = Math.min(frame.rows - 1, Math.max(Math.floor(y0), Math.floor(y1)))
  if (right < left || bottom < top) return null
  let sum = 0
  let min = Infinity
  let max = -Infinity
  let count = 0
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const v = frame.pixels[y * frame.cols + x]!
      sum += v
      if (v < min) min = v
      if (v > max) max = v
      count++
    }
  }
  if (!count) return null
  return { mean: sum / count, min, max, count }
}

export function autoWindow(frame: DicomFramePreview): { center: number; width: number } {
  if (frame.defaultWindowCenter != null && frame.defaultWindowWidth != null && frame.defaultWindowWidth > 0) {
    return { center: frame.defaultWindowCenter, width: frame.defaultWindowWidth }
  }
  const min = frame.pixelMin ?? 0
  const max = frame.pixelMax ?? 1
  const width = Math.max(1, max - min)
  return { center: min + width / 2, width }
}

/** Rec. 601 luma — RGB CR / SendToPACS secondary capture → grayscale preview. */
function rgbToLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function extractPixels(
  byteArray: Uint8Array,
  dataSet: ReturnType<typeof parseDicom>,
  rows: number,
  cols: number,
): Float32Array {
  const pixelElement = dataSet.elements.x7fe00010
  if (!pixelElement) throw new Error('PixelData etiketi yok')

  const bitsAllocated = dataSet.uint16('x00280100') ?? 16
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0
  const samplesPerPixel = dataSet.uint16('x00280002') ?? 1
  const planarConfig = dataSet.uint16('x00280006') ?? 0
  const slope = dataSet.floatString('x00281053') ?? 1
  const intercept = dataSet.floatString('x00281052') ?? 0
  if (samplesPerPixel !== 1 && samplesPerPixel !== 3) {
    throw new Error(`Çok kanallı görüntü desteklenmiyor (samples=${samplesPerPixel})`)
  }

  const transferSyntax = tag(dataSet, 'x00020010') || ''
  // Encapsulated / JPEG / RLE etc. — dicom-parser raw PixelData often unusable without a codec.
  if (
    transferSyntax &&
    transferSyntax !== '1.2.840.10008.1.2' &&
    transferSyntax !== '1.2.840.10008.1.2.1' &&
    transferSyntax !== '1.2.840.10008.1.2.2'
  ) {
    // Still try raw extract; many demo files are Explicit VR Little Endian.
    const encapsulated = Boolean(dataSet.elements.x7fe00010?.fragments?.length)
    if (encapsulated) {
      throw new Error(`Desteklenmeyen transfer syntax (sıkıştırılmış): ${transferSyntax}`)
    }
  }

  const offset = pixelElement.dataOffset
  const length = pixelElement.length
  const count = rows * cols
  const out = new Float32Array(count)

  // Color CR / SendToPACS DEMO often ships SamplesPerPixel=3 (RGB), 8-bit.
  if (samplesPerPixel === 3) {
    if (bitsAllocated !== 8) {
      throw new Error(`RGB BitsAllocated=${bitsAllocated} desteklenmiyor (yalnız 8-bit)`)
    }
    const needed = count * 3
    const view = byteArray.subarray(offset, offset + Math.min(length, needed))
    if (view.length < needed) {
      throw new Error('RGB PixelData eksik veya kısa')
    }
    if (planarConfig === 1) {
      // RRR… GGG… BBB…
      for (let i = 0; i < count; i++) {
        const r = view[i] ?? 0
        const g = view[count + i] ?? 0
        const b = view[count * 2 + i] ?? 0
        out[i] = rgbToLuma(r, g, b) * slope + intercept
      }
    } else {
      // Interleaved RGBRGB…
      for (let i = 0; i < count; i++) {
        const base = i * 3
        const r = view[base] ?? 0
        const g = view[base + 1] ?? 0
        const b = view[base + 2] ?? 0
        out[i] = rgbToLuma(r, g, b) * slope + intercept
      }
    }
    return out
  }

  if (bitsAllocated === 8) {
    const view = byteArray.subarray(offset, offset + Math.min(length, count))
    for (let i = 0; i < count; i++) out[i] = (view[i] ?? 0) * slope + intercept
    return out
  }
  if (bitsAllocated === 16) {
    const needed = count * 2
    const slice = byteArray.buffer.slice(
      byteArray.byteOffset + offset,
      byteArray.byteOffset + offset + Math.min(length, needed),
    )
    const view = pixelRepresentation === 1 ? new Int16Array(slice) : new Uint16Array(slice)
    for (let i = 0; i < count; i++) out[i] = (view[i] ?? 0) * slope + intercept
    return out
  }
  throw new Error(`BitsAllocated=${bitsAllocated} desteklenmiyor`)
}

function makeThumb(frame: DicomFramePreview): string | undefined {
  if (!frame.pixels || !frame.rows || !frame.cols) return undefined
  const canvas = document.createElement('canvas')
  const { center, width } = autoWindow(frame)
  renderFrameToCanvas(canvas, frame, { windowCenter: center, windowWidth: width })
  const thumb = document.createElement('canvas')
  const tw = 64
  const th = Math.max(1, Math.round((frame.rows / frame.cols) * tw))
  thumb.width = tw
  thumb.height = th
  const tctx = thumb.getContext('2d')
  if (!tctx) return canvas.toDataURL('image/png')
  tctx.drawImage(canvas, 0, 0, tw, th)
  return thumb.toDataURL('image/jpeg', 0.7)
}

export async function buildDicomPreview(file: File): Promise<DicomFramePreview> {
  try {
    const buf = await file.arrayBuffer()
    const byteArray = new Uint8Array(buf)
    const dataSet = parseDicom(byteArray)
    const transferSyntaxUid = tag(dataSet, 'x00020010')
    const rows = dataSet.uint16('x00280010')
    const cols = dataSet.uint16('x00280011')
    const metaBase = {
      fileName: file.name,
      relativePath: file.webkitRelativePath || undefined,
      modality: tag(dataSet, 'x00080060'),
      studyDescription: tag(dataSet, 'x00081030'),
      seriesDescription: tag(dataSet, 'x0008103e'),
      seriesInstanceUid: tag(dataSet, 'x0020000e'),
      studyInstanceUid: tag(dataSet, 'x0020000d'),
      sopInstanceUid: tag(dataSet, 'x00080018'),
      instanceNumber: dataSet.intString('x00200013'),
      transferSyntaxUid,
      imagePositionPatient: parseFloatTriplet(tag(dataSet, 'x00200032')),
      sliceLocation: firstNumber(dataSet, 'x00201041'),
    }
    if (!rows || !cols) {
      return {
        ...metaBase,
        ok: false,
        error: 'Rows/Columns okunamadı (metadata-only dosya olabilir).',
      }
    }

    const photometric = (tag(dataSet, 'x00280004') || 'MONOCHROME2').toUpperCase()
    let pixels: Float32Array
    try {
      pixels = extractPixels(byteArray, dataSet, rows, cols)
    } catch (err) {
      return {
        ...metaBase,
        ok: false,
        rows,
        cols,
        error: err instanceof Error ? err.message : 'Piksel decode başarısız',
      }
    }
    let pixelMin = Infinity
    let pixelMax = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i]!
      if (v < pixelMin) pixelMin = v
      if (v > pixelMax) pixelMax = v
    }
    if (!Number.isFinite(pixelMin) || !Number.isFinite(pixelMax)) {
      pixelMin = 0
      pixelMax = 1
    }

    const spacingRaw = tag(dataSet, 'x00280030')
    let pixelSpacingMm: [number, number] | undefined
    if (spacingRaw) {
      const parts = spacingRaw.split('\\').map((p) => Number(p))
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0]! > 0 && parts[1]! > 0) {
        pixelSpacingMm = [parts[0]!, parts[1]!]
      }
    }

    const frame: DicomFramePreview = {
      ...metaBase,
      ok: true,
      rows,
      cols,
      photometric,
      pixels,
      pixelMin,
      pixelMax,
      defaultWindowCenter: firstNumber(dataSet, 'x00281050'),
      defaultWindowWidth: firstNumber(dataSet, 'x00281051'),
      pixelSpacingMm,
    }
    frame.thumbUrl = makeThumb(frame)
    return frame
  } catch (err) {
    return {
      fileName: file.name,
      relativePath: file.webkitRelativePath || undefined,
      ok: false,
      error: err instanceof Error ? err.message : 'DICOM parse başarısız',
    }
  }
}

/** Decode files with spatial sort. Yields periodically for large studies (lazy-friendly). */
export async function buildDicomPreviews(
  files: File[],
  opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<DicomFramePreview[]> {
  const out: DicomFramePreview[] = []
  for (let i = 0; i < files.length; i++) {
    if (opts?.signal?.aborted) break
    out.push(await buildDicomPreview(files[i]!))
    opts?.onProgress?.(i + 1, files.length)
    // Yield to UI every few frames for large studies
    if (i > 0 && i % 4 === 0) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return sortFramesSpatially(out)
}

/** Client-side AI package summary (mirrors backend ImagingModelInput fields). */
export function buildClientImagingHints(frames: DicomFramePreview[]) {
  const ok = frames.filter((f) => f.ok)
  const series = new Map<string, number>()
  for (const f of ok) {
    const key = f.seriesInstanceUid || f.seriesDescription || 'unknown'
    series.set(key, (series.get(key) ?? 0) + 1)
  }
  return {
    frame_count: ok.length,
    series_count: series.size,
    modality: ok[0]?.modality ?? null,
    note: 'Display decode only. Backend ImagingModelInput is the AI contract.',
  }
}
