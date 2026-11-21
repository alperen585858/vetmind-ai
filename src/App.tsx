import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense } from 'react'
import { useApp } from './shared/shell/AppContext'
import { useLocale } from './shared/shell/LocaleContext'
import { Layout } from './shared/shell/Layout'
import { LocalePathSync } from './shared/shell/LocalePathSync'
import { Toasts } from './shared/ui/Toasts'
import { isKnownAppPath, localizePath } from './i18n/paths'
import { lazyPage } from './shared/shell/lazyPage'
import { PageLoader } from './shared/ui/PageLoader'
import { safeInternalPath } from './shared/lib/safePath'
import { publicAuthRoutes, settingsRoutes, signedInResetRoutes } from './features/auth/routes'
import { caseRoutes } from './features/cases/routes'
import { dicomRoutes } from './features/dicom/routes'
import { analysisRoutes } from './features/analysis/routes'
import { expertRoutes } from './features/expert/routes'
import { publicReportLinkRoutes, reportRoutes } from './features/reports/routes'
import { submissionRoutes } from './features/submissions/routes'
import { messagingRoutes } from './features/messaging/routes'
import { ragAdminRoutes } from './features/rag-admin/routes'
import { adminRoutes } from './features/admin/routes'
import { NotificationBell } from './features/messaging/NotificationBell'
import { SourcePanel } from './features/rag-admin/SourcePanel'

const NotFound = lazyPage(() => import('./shared/shell/NotFound'))
const Landing = lazyPage(() => import('./shared/shell/Landing'))
const Dashboard = lazyPage(() => import('./app/Dashboard'))

/** Signed out: known app URLs go to login with a safe return path; unknown URLs get a 404. */
function PublicFallback() {
  const { pathname, search } = useLocation()
  const { locale } = useLocale()
  if (!isKnownAppPath(pathname)) return <NotFound variant="public" />
  const next = safeInternalPath(`${pathname}${search}`)
  const login = localizePath('/giris', locale)
  const to = next && next !== '/' ? `${login}?next=${encodeURIComponent(next)}` : login
  return <Navigate to={to} replace />
}

/** Signed in: login/register links (known but public) go to the dashboard; unknown URLs get a 404. */
function AppFallback() {
  const { pathname } = useLocation()
  return isKnownAppPath(pathname) ? <Navigate to="/" replace /> : <NotFound variant="app" />
}

export default function App() {
  const { role } = useApp()
  return (
    <>
      <LocalePathSync />
      {!role ? (
        <Suspense fallback={<PageLoader fullScreen />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            {publicAuthRoutes}
            {publicReportLinkRoutes}
            <Route path="*" element={<PublicFallback />} />
          </Routes>
        </Suspense>
      ) : (
        <Suspense fallback={<PageLoader fullScreen />}>
          <Routes>
            {signedInResetRoutes}
            {publicReportLinkRoutes}
            <Route
              element={<Layout notificationSlot={<NotificationBell />} sourcePanel={<SourcePanel />} />}
            >
              <Route index element={<Dashboard />} />
              {caseRoutes}
              {dicomRoutes}
              {analysisRoutes}
              {expertRoutes}
              {submissionRoutes}
              {messagingRoutes}
              {reportRoutes}
              {ragAdminRoutes}
              {adminRoutes}
              {settingsRoutes}
              <Route path="giris" element={<Navigate to="/" replace />} />
              <Route path="login" element={<Navigate to="/" replace />} />
              <Route path="kayit" element={<Navigate to="/" replace />} />
              <Route path="register" element={<Navigate to="/" replace />} />
              <Route path="*" element={<AppFallback />} />
            </Route>
          </Routes>
        </Suspense>
      )}
      <Toasts />
    </>
  )
}
