import { Link, type LinkProps } from 'react-router-dom'
import { useLocale } from '../context/LocaleContext'
import { localizePath } from '../i18n/paths'

/** Link that rewrites Turkish canonical paths to the active locale. */
export function LocalizedLink({ to, ...props }: LinkProps) {
  const { locale } = useLocale()
  const localized =
    typeof to === 'string'
      ? localizePath(to, locale)
      : to && typeof to === 'object' && 'pathname' in to && typeof to.pathname === 'string'
        ? { ...to, pathname: localizePath(to.pathname, locale) }
        : to
  return <Link to={localized} {...props} />
}
