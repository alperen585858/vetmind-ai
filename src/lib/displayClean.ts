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
