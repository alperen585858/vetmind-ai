import { useApp } from '../shared/shell/AppContext'
import { ClinicOwnerDashboard } from '../features/admin/dashboard/ClinicOwnerDashboard'
import { AdminDashboard } from '../features/admin/dashboard/AdminDashboard'
import { VetDashboard } from '../features/cases/dashboard/VetDashboard'
import { OwnerDashboard } from '../features/cases/dashboard/OwnerDashboard'
import { ExpertDashboard } from '../features/expert/dashboard/ExpertDashboard'

export { GpuChart } from '../features/admin/dashboard/GpuChart'

export default function Dashboard() {
  const { role } = useApp()
  if (role === 'expert') return <ExpertDashboard />
  if (role === 'owner') return <OwnerDashboard />
  if (role === 'clinic_owner') return <ClinicOwnerDashboard />
  if (role === 'admin') return <AdminDashboard />
  return <VetDashboard />
}
