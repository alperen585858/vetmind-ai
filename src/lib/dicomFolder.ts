/**
 * Collect DICOM-like files from FileList or dragged folders (webkit directory API).
 */

const DICOM_EXT = /\.(dcm|dicom|img)$/i
const SKIP_NAMES = /^(thumbs\.db|\.ds_store|desktop\.ini)$/i

/** Max files sent to backend / kept in session (matches backend soft limit). */
export const MAX_DICOM_FILES = 200

/** Max frames rendered in the browser viewer (performance). */
export const MAX_VIEWER_FRAMES = 48

export function isLikelyDicomFile(file: File): boolean {
  if (SKIP_NAMES.test(file.name)) return false
  if (file.size <= 0) return false
  const type = (file.type || '').toLowerCase()
  if (type.includes('dicom') || type === 'application/octet-stream') {
    // Prefer extension when octet-stream; still allow no-extension DICOM dumps.
    if (DICOM_EXT.test(file.name) || !file.name.includes('.')) return true
  }
  if (DICOM_EXT.test(file.name)) return true
  // Many PACS exports use numeric names with no extension.
  if (!file.name.includes('.') && file.size > 128) return true
  return false
}

export function filterDicomFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const out: File[] = []
  for (const file of files) {
    if (!isLikelyDicomFile(file)) continue
    const key = `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(file)
  }
  // Prefer stable order: relative path then name
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

  // Fallback if directory API yielded nothing but FileList has files
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
