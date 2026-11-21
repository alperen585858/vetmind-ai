import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const CaseList = lazyPage(() => import('./CaseList'))
const NewCase = lazyPage(() => import('./NewCase'))
const CaseDetail = lazyPage(() => import('./CaseDetailPage'))

export const caseRoutes = [
  ...dualRoutes('vakalar', 'cases', <Gate roles={['vet', 'expert', 'clinic_owner']}><CaseList /></Gate>),
  ...dualRoutes('vakalar/yeni', 'cases/new', <Gate roles={['vet']}><NewCase /></Gate>),
  ...dualRoutes(
    'vakalar/:id',
    'cases/:id',
    <Gate roles={['vet', 'expert', 'clinic_owner', 'owner']}><CaseDetail /></Gate>,
  ),
]
