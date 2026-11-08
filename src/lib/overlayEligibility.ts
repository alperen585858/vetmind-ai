/** Which evidence bboxes may be drawn on the DICOM viewer (P1.6). */

export type OverlayBBox = {
  x_min: number
  y_min: number
  x_max: number
  y_max: number
  coordinate_space?: string
  transform_chain?: { name: string; params: Record<string, number> }[]
}

export type OverlayEvidenceInput = {
  evidence_id: string
  finding_id: string
  finding_index: number
  sop_instance_uid?: string | null
  frame_index?: number | null
  bbox?: OverlayBBox | null
  origin?: string | null
  /** When true, finding came from a grounded image locus (has SOP). */
  has_structured_locus?: boolean
}

export type ViewerOverlayItem = {
  evidenceId: string
  findingId: string
  /** Short on-canvas label, e.g. F1 */
  label: string
  bbox: { x_min: number; y_min: number; x_max: number; y_max: number }
  style: 'ai' | 'vet'
  selected: boolean
}

function bboxFinite(b: OverlayBBox): boolean {
  const vals = [b.x_min, b.y_min, b.x_max, b.y_max]
  if (vals.some((v) => !Number.isFinite(v))) return false
  if (b.x_max <= b.x_min || b.y_max <= b.y_min) return false
  return true
}

/** Native-space or invertibly chained model_input — otherwise refuse draw. */
export function bboxCoordinateTrusted(bbox: OverlayBBox): boolean {
  const space = (bbox.coordinate_space || 'pixel_2d_native').toLowerCase()
  if (space === 'pixel_2d_native' || space === 'pixel_2d') {
    const chain = bbox.transform_chain || []
    // Native with empty chain is trusted; non-empty chain still OK if renderer can invert.
    return true
  }
  if (space === 'model_input') {
    const chain = bbox.transform_chain || []
    return chain.length > 0
  }
  return false
}

export function findingOverlayLabel(findingIndex: number, findingId: string): string {
  const n = Math.max(1, findingIndex + 1)
  return `F${n}`
}

export type EligibleOverlayOptions = {
  activeSopUid: string | null | undefined
  activeFrameIndex: number | null | undefined
  selectedEvidenceId: string | null | undefined
  overlaysVisible: boolean
}

/**
 * Build draw list for the active frame. Ungrounded / untrusted coords omitted.
 */
export function eligibleOverlaysForFrame(
  items: OverlayEvidenceInput[],
  opts: EligibleOverlayOptions,
): ViewerOverlayItem[] {
  if (!opts.overlaysVisible) return []
  const sop = (opts.activeSopUid || '').trim()
  if (!sop) return []
  const frameIdx = opts.activeFrameIndex ?? 0
  const out: ViewerOverlayItem[] = []
  for (const item of items) {
    const evSop = (item.sop_instance_uid || '').trim()
    if (!evSop || evSop !== sop) continue
    const evFrame = item.frame_index ?? 0
    if (evFrame !== frameIdx) continue
    if (!item.bbox || !bboxFinite(item.bbox) || !bboxCoordinateTrusted(item.bbox)) continue
    // Require structured locus (SOP already checked); reject empty finding ids.
    if (!item.finding_id?.trim()) continue
    const style: 'ai' | 'vet' = item.origin === 'vet_manual' ? 'vet' : 'ai'
    out.push({
      evidenceId: item.evidence_id,
      findingId: item.finding_id,
      label: findingOverlayLabel(item.finding_index, item.finding_id),
      bbox: {
        x_min: item.bbox.x_min,
        y_min: item.bbox.y_min,
        x_max: item.bbox.x_max,
        y_max: item.bbox.y_max,
      },
      style,
      selected: Boolean(opts.selectedEvidenceId && opts.selectedEvidenceId === item.evidence_id),
    })
  }
  return out.slice(0, 20)
}

export function collectOverlayInputsFromFindings(
  findings: {
    finding_id: string
    evidence_references?: {
      evidence_id: string
      sop_instance_uid?: string | null
      frame_index?: number | null
      bbox?: OverlayBBox | null
      origin?: string | null
    }[]
  }[],
): OverlayEvidenceInput[] {
  const rows: OverlayEvidenceInput[] = []
  findings.forEach((f, finding_index) => {
    for (const ev of f.evidence_references || []) {
      rows.push({
        evidence_id: ev.evidence_id,
        finding_id: f.finding_id,
        finding_index,
        sop_instance_uid: ev.sop_instance_uid,
        frame_index: ev.frame_index,
        bbox: ev.bbox,
        origin: ev.origin,
        has_structured_locus: Boolean(ev.sop_instance_uid),
      })
    }
  })
  return rows
}
