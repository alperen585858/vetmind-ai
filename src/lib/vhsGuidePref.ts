/**
 * "Don't show the VHS guide again" preference (per browser, per viewer — a convenience,
 * not shared state). Plain "OK" keeps showing the guide; "OK" with the box ticked hides
 * it for VHS_GUIDE_SNOOZE_DAYS. Storage errors (private mode, blocked site data) simply
 * mean the guide keeps showing.
 */
export const VHS_GUIDE_KEY = 'vetmind.vhsGuide.hideUntil'
export const VHS_GUIDE_SNOOZE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function shouldShowVhsGuide(now = Date.now(), storage: StorageLike | null = defaultStorage()): boolean {
  try {
    const until = Number(storage?.getItem(VHS_GUIDE_KEY) || 0)
    return !(Number.isFinite(until) && until > now)
  } catch {
    return true
  }
}

/** Called when the guide is closed with OK. Only a ticked box snoozes it. */
export function rememberVhsGuideChoice(
  dontShowAgain: boolean,
  now = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!dontShowAgain) return
  try {
    storage?.setItem(VHS_GUIDE_KEY, String(now + VHS_GUIDE_SNOOZE_DAYS * DAY_MS))
  } catch {
    /* storage blocked: the guide will just show again */
  }
}
