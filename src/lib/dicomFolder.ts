/**
 * Collect DICOM-like files from FileList or dragged folders (webkit directory API).
 * Client-side limits mirror backend soft caps; Part-10 sniff rejects obvious non-DICOM.
 */

const DICOM_EXT = /\.(dcm|dicom|img)$/i
const SKIP_NAMES = /^(thumbs\.db|\.ds_store|desktop\.ini)$/i

/** Max files sent to backend / kept in session (matches backend soft limit). */
export const MAX_DICOM_FILES = 200

/** Max bytes per file (matches backend `_MAX_FILE_BYTES`). */
export const MAX_DICOM_FILE_BYTES = 25 * 1024 * 1024

/** Aggregate upload budget (matches backend `_MAX_TOTAL_BYTES`). */
export const MAX_DICOM_TOTAL_BYTES = 100 * 1024 * 1024

/** Max frames fetched for the browser viewer (lazy decode still yields during build). */
export const MAX_VIEWER_FRAMES = 96

export type FileRejectReason =
  | 'empty'
  | 'oversized_file'
  | 'oversized_total'
  | 'too_many'
  | 'not_dicom'
  | 'duplicate'

export type RejectedFile = {
  name: string
  reason: FileRejectReason
  detail?: string
}

export type SelectionValidation = {
  accepted: File[]
  rejected: RejectedFile[]
  truncated: number
  totalBytes: number
}

export function isLikelyDicomFile(file: File): boolean {
  if (SKIP_NAMES.test(file.name)) return false
  if (file.size <= 0) return false
  const type = (file.type || '').toLowerCase()
  if (type.includes('dicom') || type === 'application/octet-stream') {
    if (DICOM_EXT.test(file.name) || !file.name.includes('.')) return true
  }
  if (DICOM_EXT.test(file.name)) return true
  // Many PACS exports use numeric names with no extension.
  if (!file.name.includes('.') && file.size > 128) return true
  return false
}

export function fileIdentityKey(file: File): string {
  return `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`
}

export function filterDicomFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const out: File[] = []
  for (const file of files) {
    if (!isLikelyDicomFile(file)) continue
    const key = fileIdentityKey(file)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(file)
  }
  out.sort((a, b) => {
    const pa = a.webkitRelativePath || a.name
    const pb = b.webkitRelativePath || b.name
    return pa.localeCompare(pb, undefined, { numeric: true })
  })
  return out
}

export function capFiles(files: File[], max = MAX_DICOM_FILES): { files: File[]; truncated: number } {
  if (files.length <= max) return { files, truncated: 0 }
  return { files: files.slice(0, max), truncated: files.length - max }
}

/** Part-10 magic: bytes 128–131 === "DICM". */
export async function sniffDicomPart10(file: File): Promise<boolean> {
  if (file.size < 132) return false
  try {
    const buf = await file.slice(128, 132).arrayBuffer()
    const bytes = new Uint8Array(buf)
    return bytes[0] === 0x44 && bytes[1] === 0x49 && bytes[2] === 0x43 && bytes[3] === 0x4d
  } catch {
    return false
  }
}

/**
 * Synchronous budget/heuristic checks (no I/O).
 * Use {@link validateDicomSelectionAsync} for Part-10 sniffing before upload.
 */
export function validateDicomSelectionSync(
  incoming: File[],
  existing: File[] = [],
): SelectionValidation {
  const rejected: RejectedFile[] = []
  const existingKeys = new Set(existing.map(fileIdentityKey))
  const accepted: File[] = [...existing]
  let totalBytes = existing.reduce((n, f) => n + f.size, 0)
  let truncated = 0

  const filtered = filterDicomFiles(incoming)
  const heuristicRejected = incoming.length - filtered.length
  if (heuristicRejected > 0) {
    rejected.push({
      name: `(${heuristicRejected} dosya)`,
      reason: 'not_dicom',
      detail: 'Uzantı / tip filtresine uymadı',
    })
  }

  for (const file of filtered) {
    if (file.size <= 0) {
      rejected.push({ name: file.name, reason: 'empty' })
      continue
    }
    if (file.size > MAX_DICOM_FILE_BYTES) {
      rejected.push({
        name: file.name,
        reason: 'oversized_file',
        detail: `En fazla ${MAX_DICOM_FILE_BYTES} bayt`,
      })
      continue
    }
    const key = fileIdentityKey(file)
    if (existingKeys.has(key) || accepted.some((f) => fileIdentityKey(f) === key)) {
      rejected.push({ name: file.name, reason: 'duplicate' })
      continue
    }
    if (accepted.length >= MAX_DICOM_FILES) {
      truncated += 1
      rejected.push({ name: file.name, reason: 'too_many' })
      continue
    }
    if (totalBytes + file.size > MAX_DICOM_TOTAL_BYTES) {
      rejected.push({
        name: file.name,
        reason: 'oversized_total',
        detail: `Toplam bütçe ${MAX_DICOM_TOTAL_BYTES} bayt`,
      })
      continue
    }
    accepted.push(file)
    existingKeys.add(key)
    totalBytes += file.size
  }

  return {
    accepted,
    rejected,
    truncated,
    totalBytes,
  }
}

/** Async Part-10 sniff for newly added files; keeps already-accepted files. */
export async function validateDicomSelectionAsync(
  incoming: File[],
  existing: File[] = [],
  opts?: { signal?: AbortSignal; sniff?: boolean },
): Promise<SelectionValidation> {
  const sync = validateDicomSelectionSync(incoming, existing)
  if (opts?.sniff === false) return sync

  const existingSet = new Set(existing)
  const newlyAccepted = sync.accepted.filter((f) => !existingSet.has(f))
  const keptExisting = sync.accepted.filter((f) => existingSet.has(f))
  const rejected = [...sync.rejected]
  const sniffedOk: File[] = []

  for (const file of newlyAccepted) {
    if (opts?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const ok = await sniffDicomPart10(file)
    if (!ok) {
      rejected.push({
        name: file.name,
        reason: 'not_dicom',
        detail: 'DICOM Part-10 imzası (DICM) bulunamadı',
      })
      continue
    }
    sniffedOk.push(file)
  }

  const accepted = [...keptExisting, ...sniffedOk]
  return {
    accepted,
    rejected,
    truncated: sync.truncated,
    totalBytes: accepted.reduce((n, f) => n + f.size, 0),
  }
}

type DirReader = {
  readEntries: (
    ok: (entries: FileSystemEntryLike[]) => void,
    err?: (e: Error) => void,
  ) => void
}

type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (f: File) => void, err?: (e: Error) => void) => void
  createReader?: () => DirReader
}

function readAllDirectoryEntries(reader: DirReader): Promise<FileSystemEntryLike[]> {
  const acc: FileSystemEntryLike[] = []
  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries(
        (batch: FileSystemEntryLike[]) => {
          if (!batch.length) {
            resolve(acc)
            return
          }
          acc.push(...batch)
          readBatch()
        },
        (err: Error) => reject(err),
      )
    }
    readBatch()
  })
}

async function walkEntry(entry: FileSystemEntryLike, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject)
    })
    out.push(file)
    return
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    const children = await readAllDirectoryEntries(reader)
    for (const child of children) {
      await walkEntry(child, out)
    }
  }
}

/** Recursively collect files from a drag-and-drop DataTransfer (supports folders). */
export async function collectFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || [])
  if (!items.length) {
    return filterDicomFiles(Array.from(dt.files || []))
  }

  const collected: File[] = []
  const tasks: Promise<void>[] = []

  for (const item of items) {
    const anyItem = item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null
    }
    const entry = anyItem.webkitGetAsEntry?.()
    if (entry) {
      tasks.push(walkEntry(entry, collected))
    } else {
      const file = item.getAsFile()
      if (file) collected.push(file)
    }
  }

  await Promise.all(tasks)

  if (!collected.length && dt.files?.length) {
    return filterDicomFiles(Array.from(dt.files))
  }

  return filterDicomFiles(collected)
}

export function collectFilesFromFileList(list: FileList | null): File[] {
  if (!list?.length) return []
  return filterDicomFiles(Array.from(list))
}

export function displayPath(file: File): string {
  return file.webkitRelativePath || file.name
}

export function rejectReasonLabel(reason: FileRejectReason): string {
  switch (reason) {
    case 'empty':
      return 'Boş dosya'
    case 'oversized_file':
      return 'Dosya boyutu limiti aşıldı'
    case 'oversized_total':
      return 'Toplam yükleme limiti aşıldı'
    case 'too_many':
      return 'Dosya sayısı limiti aşıldı'
    case 'not_dicom':
      return 'DICOM değil / desteklenmiyor'
    case 'duplicate':
      return 'Yinelenen dosya'
    default:
      return 'Reddedildi'
  }
}
