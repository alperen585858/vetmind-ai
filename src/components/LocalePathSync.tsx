import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLocale } from '../context/LocaleContext'
import { localizePath } from '../i18n/paths'

/** Keep the address bar in sync with the active locale (on load and on language change). */
export function LocalePathSync() {
  const { locale } = useLocale()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const current = `${location.pathname}${location.search}${location.hash}`
    const next = localizePath(current, locale)
    if (next !== current) {
      navigate(next, { replace: true })
    }
  }, [locale, location.pathname, location.search, location.hash, navigate])

  return null
}
