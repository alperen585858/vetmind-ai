/**
 * Browser cache of uploaded DICOM bytes keyed by case id.
 * Used so case-detail viewer shows the user's study, not synthetic fixtures.
 * LRU eviction keeps quota bounded — no PHI is logged.
 */

const DB_NAME = 'vetmind-dicom-cache'
const STORE = 'studies'
const DB_VERSION = 1
/** Max cached studies (oldest by savedAt evicted). */
export const MAX_CACHED_STUDIES = 8

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

async function evictIfNeeded(db: IDBDatabase): Promise<void> {
  const all = await new Promise<CachedStudy[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as CachedStudy[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('IndexedDB list failed'))
  })
  if (all.length < MAX_CACHED_STUDIES) return
  const sorted = [...all].sort((a, b) => a.savedAt - b.savedAt)
  const toRemove = sorted.slice(0, Math.max(0, all.length - MAX_CACHED_STUDIES + 1))
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB evict failed'))
    const store = tx.objectStore(STORE)
    for (const row of toRemove) store.delete(row.caseId)
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
  try {
    await evictIfNeeded(db)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.objectStore(STORE).put(payload)
    })
  } finally {
    db.close()
  }
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

export async function clearDicomCaseCache(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'))
      tx.objectStore(STORE).clear()
    })
  } finally {
    db.close()
  }
}
