/** Hide placeholder clinic names from product UI. */
export function isPlaceholderClinic(name?: string | null): boolean {
  if (!name?.trim()) return true
  return /örnek\s+veteriner|ornek\s+veteriner|\(demo\)/i.test(name)
}

export function displayClinic(name?: string | null): string {
  return isPlaceholderClinic(name) ? '' : name!.trim()
}

/** Hide DICOM/pipeline boilerplate that is not clinical history. */
export function cleanClinicalHistory(text?: string | null): string {
  if (!text?.trim()) return ''
  if (
    /Case created from DICOM|No pixel-based|metadata ingest|Pixel data (was not|klinik olarak)|DICOM metadata ingest only/i.test(
      text,
    )
  ) {
    return ''
  }
  return text.trim()
}

export function displayFindingCode(code?: string | null): string {
  if (!code) return ''
  return code.replace(/^MOCK[-_]/i, '').replace(/_/g, '-')
}

export function displayFindingDescription(desc?: string | null): string {
  if (!desc) return ''
  return desc
    .replace(/^SENTETİK\s+DEMO\s+BULGU(\s*\([^)]*\))?:\s*/i, '')
    .replace(/^SYNTHETIC\s+MOCK\s+FINDING:\s*/i, '')
    .replace(/\s*This statement is a fixture[^.]*\./i, '')
    .replace(/\s*Bu ifade sistem testi[^.]*\./i, '')
    .replace(/\s*Sistem testi için örnek[^.]*\./i, '')
    .replace(/\s*Yalnızca örnek veri[^.]*\./i, '')
    .replace(/\s*\(sentetik\)/gi, '')
    .trim()
}

type Translate = (key: string) => string

const MODALITY_KEYS = new Set(['MR', 'CT', 'XR', 'OTHER'])
const REGION_KEYS = new Set(['BRAIN', 'CERVICAL', 'THORAX', 'OTHER', 'UNKNOWN'])

/** "CT" → "BT" / "CT" by locale; unknown DICOM codes (DX, CR…) are shown as-is. */
export function modalityLabel(t: Translate, modality?: string | null): string {
  if (!modality) return ''
  return MODALITY_KEYS.has(modality) ? t(`modalityName.${modality}`) : modality
}

/** "BRAIN" → "Beyin" / "Brain" by locale. */
export function regionLabel(t: Translate, region?: string | null): string {
  if (!region) return ''
  return REGION_KEYS.has(region) ? t(`regionName.${region}`) : region
}

const CONFIDENCE_KEYS = new Set(['high', 'medium', 'low', 'unknown'])

/** "medium" → "orta güven" / "medium confidence". */
export function confidenceLabel(t: Translate, confidence?: string | null): string {
  if (!confidence) return ''
  return CONFIDENCE_KEYS.has(confidence) ? t(`confidenceName.${confidence}`) : confidence
}

/** "CT · BRAIN" → "BT · Beyin". */
export function studyLabel(t: Translate, modality?: string | null, region?: string | null, separator = ' · '): string {
  return [modalityLabel(t, modality), regionLabel(t, region)].filter(Boolean).join(separator)
}
