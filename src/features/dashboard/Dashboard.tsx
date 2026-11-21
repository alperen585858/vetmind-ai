import { useApp } from '../../context/AppContext'
import { ClinicOwnerDashboard } from '../admin/dashboard/ClinicOwnerDashboard'
import { AdminDashboard } from '../admin/dashboard/AdminDashboard'
import { VetDashboard } from '../cases/dashboard/VetDashboard'
import { OwnerDashboard } from '../cases/dashboard/OwnerDashboard'
import { ExpertDashboard } from '../expert/dashboard/ExpertDashboard'

export { GpuChart } from '../admin/dashboard/GpuChart'

export default function Dashboard() {
  const { role } = useApp()
  if (role === 'expert') return <ExpertDashboard />
  if (role === 'owner') return <OwnerDashboard />
  if (role === 'clinic_owner') return <ClinicOwnerDashboard />
  if (role === 'admin') return <AdminDashboard />
  return <VetDashboard />
}
