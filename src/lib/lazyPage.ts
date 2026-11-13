import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const RELOAD_FLAG = 'vetmind.chunk-reload'

/**
 * React.lazy for route pages (issue #25: each page is its own chunk).
 *
 * After a new deploy the hashed chunk a stale tab asks for may no longer exist. Instead of
 * leaving the user on a crashed page, reload once to pick up the new build; if the import
 * still fails right after that reload, let the error surface.
 */
export function lazyPage<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await load()
      safeSession(() => sessionStorage.removeItem(RELOAD_FLAG))
      return mod
    } catch (err) {
      const alreadyRetried = safeSession(() => sessionStorage.getItem(RELOAD_FLAG)) === '1'
      if (!alreadyRetried && typeof window !== 'undefined') {
        safeSession(() => sessionStorage.setItem(RELOAD_FLAG, '1'))
        window.location.reload()
        // Keep Suspense waiting while the page reloads.
        return new Promise<never>(() => {})
      }
      throw err
    }
  })
}

function safeSession<R>(fn: () => R): R | null {
  try {
    return fn()
  } catch {
    return null
  }
}
