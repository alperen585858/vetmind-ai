import { describe, expect, it } from 'vitest'
import { modelRefsFromStudy, validateStudyIdentity } from './studyIdentity'

describe('studyIdentity', () => {
  it('accepts a consistent Study/Series/SOP tree', () => {
    const result = validateStudyIdentity({
      study_instance_uid: '1.2.3',
      series: [
        {
          series_instance_uid: '1.2.3.1',
          instances: [
            { sop_instance_uid: '1.2.3.1.1' },
            { sop_instance_uid: '1.2.3.1.2' },
          ],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('flags duplicate SOP and empty study UID', () => {
    expect(validateStudyIdentity(null).ok).toBe(false)
    const dup = validateStudyIdentity({
      study_instance_uid: '1.2.3',
      series: [
        {
          series_instance_uid: 's1',
          instances: [
            { sop_instance_uid: 'sop-a' },
            { sop_instance_uid: 'sop-a' },
          ],
        },
      ],
    })
    expect(dup.ok).toBe(false)
    expect(dup.issues.some((i) => i.code === 'DUPLICATE_SOP_UID')).toBe(true)
  })

  it('extracts stable model refs without inventing UIDs', () => {
    const refs = modelRefsFromStudy({
      study_instance_uid: 'study-1',
      series: [
        {
          series_instance_uid: 'series-1',
          instances: [{ sop_instance_uid: 'sop-1' }],
        },
      ],
    })
    expect(refs).toEqual({
      studyInstanceUid: 'study-1',
      seriesInstanceUids: ['series-1'],
      sopInstanceUids: ['sop-1'],
    })
    expect(modelRefsFromStudy(null).studyInstanceUid).toBeNull()
  })
})
