import type { ReactNode } from 'react'
import { Navigate, Route, useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { useLocale } from '../../context/LocaleContext'
import { localizePath } from '../../i18n/paths'
import type { Role } from '../../types'

export function Gate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useApp()
  const { locale } = useLocale()
  if (role && roles.includes(role)) return <>{children}</>
  return <Navigate to={localizePath('/', locale)} replace />
}

/** Legacy /inceleme|/review → canonical radiologist workspace. */
export function ExpertReviewRedirect() {
  const { id } = useParams()
  const { locale } = useLocale()
  if (!id || id === 'undefined') {
    return <Navigate to={localizePath('/kuyruk', locale)} replace />
  }
  return <Navigate to={localizePath(`/vakalar/${id}/calisma`, locale)} replace />
}

/** Register the same page under Turkish and English path patterns. */
export function dualRoutes(tr: string, en: string, element: ReactNode) {
  return [
    <Route key={`tr:${tr}`} path={tr} element={element} />,
    <Route key={`en:${en}`} path={en} element={element} />,
  ]
}
