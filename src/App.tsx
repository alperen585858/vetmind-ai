import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useApp } from './context/AppContext'
import { Layout } from './components/Layout'
import { Toasts } from './components/Toasts'
import { Card } from './components/Card'
import { EmptyState } from './components/EmptyState'
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
  if (role && roles.includes(role)) return <>{children}</>
  const hint = authMode.roleSwitchAllowed
    ? 'Bu içerik seçili rol için görüntülenemez. Demo modunda üst bardan rol değiştirebilirsiniz. Rol kapıları yalnızca UX’tir; korumalı veri için backend auth zorunludur.'
    : 'Bu içerik hesabınızın rolü için görüntülenemez. Doğru hesapla yeniden giriş yapın. Sunucu RBAC asıl yetki kaynağıdır.'
  return (
    <Card>
      <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Bu sayfaya erişim yetkiniz yok" text={hint} />
    </Card>
  )
}

/** Legacy /inceleme → canonical radiologist workspace. */
function ExpertReviewRedirect() {
  const { id } = useParams()
  return <Navigate to={`/vakalar/${id}/calisma`} replace />
}

export default function App() {
  const { role } = useApp()
  return (
    <>
      {!role ? (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/giris" element={<Login />} />
          <Route path="/kayit" element={<Register />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="vakalar" element={<Gate roles={['vet', 'expert', 'clinic_owner']}><CaseList /></Gate>} />
            <Route path="vakalar/yeni" element={<Gate roles={['vet']}><NewCase /></Gate>} />
            <Route path="dicom-yukle" element={<Gate roles={['vet']}><DicomUpload /></Gate>} />
            <Route path="vakalar/:id" element={<Gate roles={['vet', 'expert', 'clinic_owner', 'owner']}><CaseDetail /></Gate>} />
            <Route path="vakalar/:id/isleme" element={<Gate roles={['vet', 'expert']}><Processing /></Gate>} />
            <Route
              path="vakalar/:id/inceleme"
              element={
                <Gate roles={['expert']}>
                  <ExpertReviewRedirect />
                </Gate>
              }
            />
            <Route path="vakalar/:id/calisma" element={<Gate roles={['expert']}><RadiologistWorkspace /></Gate>} />
            <Route path="kuyruk" element={<Gate roles={['expert']}><ReviewQueue /></Gate>} />
            <Route path="hayvanlar" element={<Gate roles={['owner']}><OwnerPets /></Gate>} />
            <Route path="basvurular" element={<Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>} />
            <Route path="basvurular/:submissionId" element={<Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>} />
            <Route path="mesajlar" element={<Gate roles={['owner', 'expert', 'admin']}><Messages /></Gate>} />
            <Route path="mesajlar/:threadId" element={<Gate roles={['owner', 'expert', 'admin']}><Messages /></Gate>} />
            <Route path="kullanicilar" element={<Gate roles={['admin']}><AdminUsers /></Gate>} />
            <Route path="raporlar" element={<Gate roles={['vet', 'owner', 'expert', 'clinic_owner']}><ReportList /></Gate>} />
            <Route path="raporlar/:id" element={<Gate roles={['vet', 'owner', 'expert', 'clinic_owner']}><ApprovedReport /></Gate>} />
            <Route path="moduller" element={<Gate roles={['admin']}><Modules /></Gate>} />
            <Route path="bilgi-tabani" element={<Gate roles={['admin']}><KnowledgeBase /></Gate>} />
            <Route path="sistem" element={<Gate roles={['admin']}><SystemStatus /></Gate>} />
            <Route path="model-performansi" element={<Gate roles={['admin']}><ModelPerformance /></Gate>} />
            <Route
              path="ayarlar"
              element={
                <Gate roles={['vet', 'expert', 'owner', 'clinic_owner', 'admin']}>
                  <Settings />
                </Gate>
              }
            />
            <Route path="giris" element={<Navigate to="/" replace />} />
            <Route path="kayit" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      <Toasts />
    </>
  )
}
