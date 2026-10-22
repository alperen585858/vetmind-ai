import { Navigate, Route, Routes } from 'react-router-dom'
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
import ExpertReview from './pages/ExpertReview'
import ReviewQueue from './pages/ReviewQueue'
import ReportList from './pages/ReportList'
import ApprovedReport from './pages/ApprovedReport'
import Modules from './pages/Modules'
import KnowledgeBase from './pages/KnowledgeBase'
import SystemStatus from './pages/SystemStatus'

function Gate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useApp()
  if (role && roles.includes(role)) return <>{children}</>
  return (
    <Card>
      <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Bu sayfaya erişim yetkiniz yok" text="Bu içerik seçili rol için görüntülenemez. Üst bardan rol değiştirerek erişebilirsiniz." />
    </Card>
  )
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
            <Route path="vakalar" element={<Gate roles={['vet', 'expert']}><CaseList /></Gate>} />
            <Route path="vakalar/yeni" element={<Gate roles={['vet']}><NewCase /></Gate>} />
            <Route path="dicom-yukle" element={<Gate roles={['vet']}><DicomUpload /></Gate>} />
            <Route path="vakalar/:id" element={<Gate roles={['vet', 'expert']}><CaseDetail /></Gate>} />
            <Route path="vakalar/:id/isleme" element={<Gate roles={['vet', 'expert']}><Processing /></Gate>} />
            <Route path="vakalar/:id/inceleme" element={<Gate roles={['expert']}><ExpertReview /></Gate>} />
            <Route path="kuyruk" element={<Gate roles={['expert']}><ReviewQueue /></Gate>} />
            <Route path="raporlar" element={<Gate roles={['vet', 'owner', 'expert']}><ReportList /></Gate>} />
            <Route path="raporlar/:id" element={<Gate roles={['vet', 'owner', 'expert']}><ApprovedReport /></Gate>} />
            <Route path="moduller" element={<Gate roles={['admin']}><Modules /></Gate>} />
            <Route path="bilgi-tabani" element={<Gate roles={['admin']}><KnowledgeBase /></Gate>} />
            <Route path="sistem" element={<Gate roles={['admin']}><SystemStatus /></Gate>} />
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
