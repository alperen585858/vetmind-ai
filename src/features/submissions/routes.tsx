import { lazyPage } from '../../lib/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const OwnerPets = lazyPage(() => import('./OwnerPets'))
const Submissions = lazyPage(() => import('./Submissions'))

export const submissionRoutes = [
  ...dualRoutes('hayvanlar', 'pets', <Gate roles={['owner']}><OwnerPets /></Gate>),
  ...dualRoutes(
    'basvurular',
    'submissions',
    <Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>,
  ),
  ...dualRoutes(
    'basvurular/:submissionId',
    'submissions/:submissionId',
    <Gate roles={['owner', 'vet', 'clinic_owner']}><Submissions /></Gate>,
  ),
]
