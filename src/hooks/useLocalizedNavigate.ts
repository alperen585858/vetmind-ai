import { useCallback } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'
import { useLocale } from '../context/LocaleContext'
import { localizePath } from '../i18n/paths'

/** navigate() that localizes string paths to the active locale. */
export function useLocalizedNavigate() {
  const navigate = useNavigate()
  const { locale } = useLocale()

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to)
        return
      }
      if (typeof to === 'string') {
        navigate(localizePath(to, locale), options)
        return
      }
      if (to && typeof to === 'object' && 'pathname' in to && typeof to.pathname === 'string') {
        navigate({ ...to, pathname: localizePath(to.pathname, locale) }, options)
        return
      }
      navigate(to, options)
    },
    [navigate, locale],
  )
}

export function useLocalePath() {
  const { locale } = useLocale()
  return useCallback((path: string) => localizePath(path, locale), [locale])
}
