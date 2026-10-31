import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
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
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import CaseList from './pages/CaseList'
import NewCase from './pages/NewCase'
import DicomUpload from './pages/DicomUpload'
import Processing from './pages/Processing'
import CaseDetail from './pages/CaseDetail'
import RadiologistWorkspace from './pages/RadiologistWorkspace'
import ExpertAiResend from './pages/ExpertAiResend'
import ReviewQueue from './pages/ReviewQueue'
import ReportList from './pages/ReportList'
import ApprovedReport from './pages/ApprovedReport'
import Modules from './pages/Modules'
import KnowledgeBase from './pages/KnowledgeBase'
import SystemStatus from './pages/SystemStatus'
import ModelPerformance from './pages/ModelPerformance'
import OwnerPets from './pages/OwnerPets'
import Submissions from './pages/Submissions'
import Messages from './pages/Messages'
import AdminUsers from './pages/AdminUsers'
import Settings from './pages/Settings'

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

export default function App() {
  const { role } = useApp()
  return (
    <>
      <LocalePathSync />
      {!role ? (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/giris" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kayit" element={<Register />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      <Toasts />
    </>
  )
}
