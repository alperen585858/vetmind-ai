/**
 * Client-side DICOM decode for radiologist viewing.
 * Keeps float pixels so window/level can be adjusted live.
 * NOT pixel-based AI diagnosis.
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
  /** Cached thumbnail data URL (auto window). */
  thumbUrl?: string
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
    const o = i * 4
    image.data[o] = g
    image.data[o + 1] = g
    image.data[o + 2] = g
    image.data[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
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
  const slope = dataSet.floatString('x00281053') ?? 1
  const intercept = dataSet.floatString('x00281052') ?? 0
  if (samplesPerPixel !== 1) throw new Error(`Çok kanallı görüntü desteklenmiyor (samples=${samplesPerPixel})`)

  const offset = pixelElement.dataOffset
  const length = pixelElement.length
  const count = rows * cols
  const out = new Float32Array(count)

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
  // Downscale thumb
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
    const rows = dataSet.uint16('x00280010')
    const cols = dataSet.uint16('x00280011')
    if (!rows || !cols) {
      return {
        fileName: file.name,
        relativePath: file.webkitRelativePath || undefined,
        ok: false,
        error: 'Rows/Columns okunamadı (metadata-only dosya olabilir).',
        modality: tag(dataSet, 'x00080060'),
        studyDescription: tag(dataSet, 'x00081030'),
        seriesDescription: tag(dataSet, 'x0008103e'),
      }
    }

    const photometric = (tag(dataSet, 'x00280004') || 'MONOCHROME2').toUpperCase()
    const pixels = extractPixels(byteArray, dataSet, rows, cols)
    let pixelMin = Infinity
    let pixelMax = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i]
      if (v < pixelMin) pixelMin = v
      if (v > pixelMax) pixelMax = v
    }
    if (!Number.isFinite(pixelMin) || !Number.isFinite(pixelMax)) {
      pixelMin = 0
      pixelMax = 1
    }

    const frame: DicomFramePreview = {
      fileName: file.name,
      relativePath: file.webkitRelativePath || undefined,
      ok: true,
      modality: tag(dataSet, 'x00080060'),
      rows,
      cols,
      studyDescription: tag(dataSet, 'x00081030'),
      seriesDescription: tag(dataSet, 'x0008103e'),
      seriesInstanceUid: tag(dataSet, 'x0020000e'),
      sopInstanceUid: tag(dataSet, 'x00080018'),
      instanceNumber: dataSet.intString('x00200013'),
      photometric,
      pixels,
      pixelMin,
      pixelMax,
      defaultWindowCenter: firstNumber(dataSet, 'x00281050'),
      defaultWindowWidth: firstNumber(dataSet, 'x00281051'),
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

export async function buildDicomPreviews(files: File[]): Promise<DicomFramePreview[]> {
  const out: DicomFramePreview[] = []
  for (const file of files) {
    out.push(await buildDicomPreview(file))
  }
  // Sort by instance number when available
  out.sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0))
  return out
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
