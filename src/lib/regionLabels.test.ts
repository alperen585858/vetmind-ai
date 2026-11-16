import { describe, expect, it } from 'vitest'
import en from '../i18n/en.json'
import tr from '../i18n/tr.json'
import { clinicalModuleFromStudy } from './caseMapper'
import { regionLabel } from './displayClean'
import type { BackendAnatomicalRegion } from '../types'

// Keep in sync with BackendAnatomicalRegion (types.ts) and AnatomicalRegion (backend enums.py).
const REGIONS: BackendAnatomicalRegion[] = ['BRAIN', 'CERVICAL', 'THORAX', 'THORACOLUMBAR', 'OTHER', 'UNKNOWN']

describe('region labels (#49)', () => {
  it('every region has a Turkish and English name', () => {
    expect(Object.keys(tr.regionName).sort()).toEqual([...REGIONS].sort())
    expect(Object.keys(en.regionName).sort()).toEqual([...REGIONS].sort())
  })

  it('shows thoracolumbar by its translated name', () => {
    const t = (key: string) => (key === 'regionName.THORACOLUMBAR' ? tr.regionName.THORACOLUMBAR : key)
    expect(regionLabel(t, 'THORACOLUMBAR')).toBe('Torakolomber')
  })

  it('a thoracolumbar study belongs to neurology, also on radiographs', () => {
    expect(clinicalModuleFromStudy('THORACOLUMBAR', 'MR')).toBe('Nöroloji')
    expect(clinicalModuleFromStudy('THORACOLUMBAR', 'XR')).toBe('Nöroloji')
    expect(clinicalModuleFromStudy('THORAX', 'XR')).toBe('Toraks')
  })
})
