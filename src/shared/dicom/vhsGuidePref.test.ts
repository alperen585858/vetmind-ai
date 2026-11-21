import { describe, expect, it } from 'vitest'
import { rememberVhsGuideChoice, shouldShowVhsGuide, VHS_GUIDE_KEY } from './vhsGuidePref'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 14)

describe('VHS guide preference', () => {
  it('shows the guide by default', () => {
    expect(shouldShowVhsGuide(NOW, memoryStorage())).toBe(true)
  })

  it('plain OK keeps showing it', () => {
    const s = memoryStorage()
    rememberVhsGuideChoice(false, NOW, s)
    expect(s.data.has(VHS_GUIDE_KEY)).toBe(false)
    expect(shouldShowVhsGuide(NOW + DAY, s)).toBe(true)
  })

  it('"don\'t show again" hides it for 30 days, then it comes back', () => {
    const s = memoryStorage()
    rememberVhsGuideChoice(true, NOW, s)
    expect(shouldShowVhsGuide(NOW + 29 * DAY, s)).toBe(false)
    expect(shouldShowVhsGuide(NOW + 31 * DAY, s)).toBe(true)
  })

  it('blocked storage never breaks: the guide just shows', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => rememberVhsGuideChoice(true, NOW, broken)).not.toThrow()
    expect(shouldShowVhsGuide(NOW, broken)).toBe(true)
    expect(shouldShowVhsGuide(NOW, null)).toBe(true)
  })
})
