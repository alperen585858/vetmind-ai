/**
 * Browser cache of uploaded DICOM bytes keyed by case id.
 * Used so case-detail viewer shows the user's study, not synthetic fixtures.
 */

const DB_NAME = 'vetmind-dicom-cache'
const STORE = 'studies'
const DB_VERSION = 1

type CachedStudy = {
  caseId: string
  savedAt: number
  files: { name: string; type: string; buffer: ArrayBuffer }[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'caseId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export async function cacheCaseDicomFiles(caseId: string, files: File[]): Promise<void> {
  if (!caseId || !files.length) return
  const payload: CachedStudy = {
    caseId,
    savedAt: Date.now(),
    files: await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        type: f.type || 'application/dicom',
        buffer: await f.arrayBuffer(),
      })),
    ),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.objectStore(STORE).put(payload)
  })
  db.close()
}

export async function loadCachedCaseDicomFiles(caseId: string): Promise<File[] | null> {
  if (!caseId) return null
  try {
    const db = await openDb()
    const row = await new Promise<CachedStudy | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(caseId)
      req.onsuccess = () => resolve(req.result as CachedStudy | undefined)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
    db.close()
    if (!row?.files?.length) return null
    return row.files.map((f) => new File([f.buffer], f.name, { type: f.type || 'application/dicom' }))
  } catch {
    return null
  }
}
