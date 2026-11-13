import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { isKnownAppPath } from './i18n/paths'
import { Suspense, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useApp } from './context/AppContext'
import { useLocale } from './context/LocaleContext'
import { Layout } from './components/Layout'
import { LocalePathSync } from './components/LocalePathSync'
import { Toasts } from './components/Toasts'
import { Card } from './components/Card'
import { EmptyState } from './components/EmptyState'
import { localizePath } from './i18n/paths'
import type { Role } from './types'
import { lazyPage } from './lib/lazyPage'
import { PageLoader } from './components/PageLoader'

// Each page is its own chunk (issue #25); only the visited page is downloaded.
const NotFound = lazyPage(() => import('./pages/NotFound'))
const Landing = lazyPage(() => import('./pages/Landing'))
const Login = lazyPage(() => import('./pages/Login'))
const Register = lazyPage(() => import('./pages/Register'))
const ForgotPassword = lazyPage(() => import('./pages/ForgotPassword'))
const ResetPassword = lazyPage(() => import('./pages/ResetPassword'))
const Dashboard = lazyPage(() => import('./pages/Dashboard'))
const CaseList = lazyPage(() => import('./pages/CaseList'))
const NewCase = lazyPage(() => import('./pages/NewCase'))
const DicomUpload = lazyPage(() => import('./pages/DicomUpload'))
const Processing = lazyPage(() => import('./pages/Processing'))
const CaseDetail = lazyPage(() => import('./pages/CaseDetail'))
const RadiologistWorkspace = lazyPage(() => import('./pages/RadiologistWorkspace'))
const ExpertAiResend = lazyPage(() => import('./pages/ExpertAiResend'))
const ReviewQueue = lazyPage(() => import('./pages/ReviewQueue'))
const ReportList = lazyPage(() => import('./pages/ReportList'))
const ApprovedReport = lazyPage(() => import('./pages/ApprovedReport'))
const Modules = lazyPage(() => import('./pages/Modules'))
const KnowledgeBase = lazyPage(() => import('./pages/KnowledgeBase'))
const SystemStatus = lazyPage(() => import('./pages/SystemStatus'))
const ModelPerformance = lazyPage(() => import('./pages/ModelPerformance'))
const AiLessons = lazyPage(() => import('./pages/AiLessons'))
const OwnerPets = lazyPage(() => import('./pages/OwnerPets'))
const Submissions = lazyPage(() => import('./pages/Submissions'))
const Messages = lazyPage(() => import('./pages/Messages'))
const AdminUsers = lazyPage(() => import('./pages/AdminUsers'))
const AdminRadiologists = lazyPage(() => import('./pages/AdminRadiologists'))
const Settings = lazyPage(() => import('./pages/Settings'))

function Gate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role, authMode } = useApp()
  const { t } = useLocale()
  if (role && roles.includes(role)) return <>{children}</>
  const hint = authMode.roleSwitchAllowed ? t('gate.hintDemo') : t('gate.hintAuth')
  return (
    <Card>
      <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title={t('gate.title')} text={hint} />
    </Card>
  )
}

/** Legacy /inceleme|/review → canonical radiologist workspace. */
function ExpertReviewRedirect() {
  const { id } = useParams()
  const { locale } = useLocale()
  return <Navigate to={localizePath(`/vakalar/${id}/calisma`, locale)} replace />
}

/** Register the same page under Turkish and English path patterns. */
function dualRoutes(tr: string, en: string, element: ReactNode) {
  return [
    <Route key={`tr:${tr}`} path={tr} element={element} />,
    <Route key={`en:${en}`} path={en} element={element} />,
  ]
}

/** Signed out: app pages (e.g. a shared case link) still go to the landing page; unknown URLs get a 404. */
function PublicFallback() {
  const { pathname } = useLocation()
  return isKnownAppPath(pathname) ? <Navigate to="/" replace /> : <NotFound variant="public" />
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
          <Route path="/giris" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kayit" element={<Register />} />
          <Route path="/register" element={<Register />} />
          {dualRoutes('/sifremi-unuttum', '/forgot-password', <ForgotPassword />)}
          {dualRoutes('/sifre-sifirla', '/reset-password', <ResetPassword />)}
          <Route path="*" element={<PublicFallback />} />
        </Routes>
        </Suspense>
      ) : (
        <Suspense fallback={<PageLoader fullScreen />}>
        <Routes>
          {/* Emailed reset links work even when this browser is still signed in. */}
          {dualRoutes('/sifre-sifirla', '/reset-password', <ResetPassword />)}
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            {dualRoutes('vakalar', 'cases', <Gate roles={['vet', 'expert', 'clinic_owner']}><CaseList /></Gate>)}
            {dualRoutes('vakalar/yeni', 'cases/new', <Gate roles={['vet']}><NewCase /></Gate>)}
            {dualRoutes('dicom-yukle', 'dicom-upload', <Gate roles={['vet']}><DicomUpload /></Gate>)}
            {dualRoutes(
              'vakalar/:id',
              'cases/:id',
              <Gate roles={['vet', 'expert', 'clinic_owner', 'owner']}><CaseDetail /></Gate>,
            )}
            {dualRoutes(
              'vakalar/:id/isleme',
              'cases/:id/processing',
              <Gate roles={['vet', 'expert']}><Processing /></Gate>,
            )}
            {dualRoutes(
              'vakalar/:id/inceleme',
              'cases/:id/review',
              <Gate roles={['expert']}><ExpertReviewRedirect /></Gate>,
            )}
            {dualRoutes(
              'vakalar/:id/calisma',
              'cases/:id/workspace',
              <Gate roles={['expert']}><RadiologistWorkspace /></Gate>,
            )}
            {dualRoutes('kuyruk', 'queue', <Gate roles={['expert']}><ReviewQueue /></Gate>)}
            {dualRoutes('ai-tekrar', 'ai-resend', <Gate roles={['expert']}><ExpertAiResend /></Gate>)}
            {dualRoutes('ai-dersleri', 'ai-lessons', <Gate roles={['expert', 'admin']}><AiLessons /></Gate>)}
            {dualRoutes('hayvanlar', 'pets', <Gate roles={['owner']}><OwnerPets /></Gate>)}
            {dualRoutes(
              'basvurular',
              'submissions',
              <Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>,
            )}
            {dualRoutes(
              'basvurular/:submissionId',
              'submissions/:submissionId',
              <Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>,
            )}
            {dualRoutes('mesajlar', 'messages', <Gate roles={['owner', 'expert', 'admin']}><Messages /></Gate>)}
            {dualRoutes(
              'mesajlar/:threadId',
              'messages/:threadId',
              <Gate roles={['owner', 'expert', 'admin']}><Messages /></Gate>,
            )}
            {dualRoutes('kullanicilar', 'users', <Gate roles={['admin']}><AdminUsers /></Gate>)}
            {dualRoutes('radyologlarim', 'my-radiologists', <Gate roles={['admin']}><AdminRadiologists /></Gate>)}
            {dualRoutes(
              'raporlar',
              'reports',
              <Gate roles={['vet', 'owner', 'expert', 'clinic_owner']}><ReportList /></Gate>,
            )}
            {dualRoutes(
              'raporlar/:id',
              'reports/:id',
              <Gate roles={['vet', 'owner', 'expert', 'clinic_owner']}><ApprovedReport /></Gate>,
            )}
            {dualRoutes('moduller', 'modules', <Gate roles={['admin']}><Modules /></Gate>)}
            {dualRoutes('bilgi-tabani', 'knowledge-base', <Gate roles={['admin']}><KnowledgeBase /></Gate>)}
            {dualRoutes('sistem', 'system', <Gate roles={['admin']}><SystemStatus /></Gate>)}
            {dualRoutes(
              'model-performansi',
              'model-performance',
              <Gate roles={['admin']}><ModelPerformance /></Gate>,
            )}
            {dualRoutes(
              'ayarlar',
              'settings',
              <Gate roles={['vet', 'expert', 'owner', 'clinic_owner', 'admin']}><Settings /></Gate>,
            )}
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
