import { describe, expect, it } from 'vitest'
import {
  MAX_DICOM_FILE_BYTES,
  MAX_DICOM_FILES,
  fileIdentityKey,
  filterDicomFiles,
  isLikelyDicomFile,
  sniffDicomPart10,
  validateDicomSelectionSync,
} from './dicomFolder'

function makeFile(name: string, size: number, opts?: { lastModified?: number; type?: string }): File {
  const buf = new Uint8Array(Math.min(size, 256))
  const file = new File([buf], name, {
    type: opts?.type ?? 'application/dicom',
    lastModified: opts?.lastModified ?? 1,
  })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function makePart10File(name: string, extra = 0): File {
  const bytes = new Uint8Array(132 + extra)
  bytes[128] = 0x44
  bytes[129] = 0x49
  bytes[130] = 0x43
  bytes[131] = 0x4d
  return new File([bytes], name, { type: 'application/dicom', lastModified: 1 })
}

describe('dicomFolder heuristics', () => {
  it('accepts .dcm and extensionless dumps', () => {
    expect(isLikelyDicomFile(makeFile('a.dcm', 200))).toBe(true)
    expect(isLikelyDicomFile(makeFile('12345', 200))).toBe(true)
    expect(isLikelyDicomFile(makeFile('notes.txt', 200, { type: 'text/plain' }))).toBe(false)
    expect(isLikelyDicomFile(makeFile('empty.dcm', 0))).toBe(false)
  })

  it('dedupes by identity key', () => {
    const a = makeFile('a.dcm', 100, { lastModified: 9 })
    const b = makeFile('a.dcm', 100, { lastModified: 9 })
    const c = makeFile('a.dcm', 100, { lastModified: 10 })
    expect(fileIdentityKey(a)).toBe(fileIdentityKey(b))
    const filtered = filterDicomFiles([a, b, c])
    expect(filtered).toHaveLength(2)
  })

  it('rejects oversized files and duplicates in sync validation', () => {
    const existing = [makeFile('keep.dcm', 100)]
    const oversized = makeFile('big.dcm', MAX_DICOM_FILE_BYTES + 1)
    const dup = makeFile('keep.dcm', 100)
    const ok = makeFile('ok.dcm', 50)
    const result = validateDicomSelectionSync([oversized, dup, ok], existing)
    expect(result.accepted.map((f) => f.name).sort()).toEqual(['keep.dcm', 'ok.dcm'])
    expect(result.rejected.some((r) => r.reason === 'oversized_file')).toBe(true)
    expect(result.rejected.some((r) => r.reason === 'duplicate')).toBe(true)
  })

  it('caps file count', () => {
    const existing = Array.from({ length: MAX_DICOM_FILES }, (_, i) => makeFile(`f${i}.dcm`, 10))
    const extra = makeFile('extra.dcm', 10)
    const result = validateDicomSelectionSync([extra], existing)
    expect(result.accepted).toHaveLength(MAX_DICOM_FILES)
    expect(result.rejected.some((r) => r.reason === 'too_many')).toBe(true)
  })

  it('sniffs Part-10 DICM magic', async () => {
    const good = makePart10File('good.dcm')
    const bad = makeFile('bad.dcm', 200)
    expect(await sniffDicomPart10(good)).toBe(true)
    expect(await sniffDicomPart10(bad)).toBe(false)
  })
})
