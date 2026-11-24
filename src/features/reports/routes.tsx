import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const ReportLink = lazyPage(() => import('./ReportLink'))
const ReportList = lazyPage(() => import('./ReportList'))
const ApprovedReport = lazyPage(() => import('./ApprovedReport'))

export const publicReportLinkRoutes = [
  ...dualRoutes('/rapor-baglanti', '/report-link', <ReportLink />),
]

export const reportRoutes = [
  ...dualRoutes(
    'raporlar',
    'reports',
    <Gate roles={['vet', 'expert', 'clinic_owner']}><ReportList /></Gate>,
  ),
  ...dualRoutes(
    'raporlar/:id',
    'reports/:id',
    <Gate roles={['vet', 'expert', 'clinic_owner']}><ApprovedReport /></Gate>,
  ),
]
