import { Navigate } from 'react-router-dom'
import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'
import { useLocale } from '../../shared/shell/LocaleContext'
import { localizePath } from '../../i18n/paths'

const ReportLink = lazyPage(() => import('./ReportLink'))
const ApprovedReport = lazyPage(() => import('./ApprovedReport'))

/** #81: approved reports live in the case list ("Onaylı raporlar" filter). */
function ToApprovedCases() {
  const { locale } = useLocale()
  return <Navigate to={`${localizePath('/vakalar', locale)}?durum=onaylandi`} replace />
}

export const publicReportLinkRoutes = [
  ...dualRoutes('/rapor-baglanti', '/report-link', <ReportLink />),
]

export const reportRoutes = [
  ...dualRoutes('raporlar', 'reports', <ToApprovedCases />),
  ...dualRoutes(
    'raporlar/:id',
    'reports/:id',
    <Gate roles={['vet', 'expert', 'clinic_owner']}><ApprovedReport /></Gate>,
  ),
]
