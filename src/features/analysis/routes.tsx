import { lazyPage } from '../../lib/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const Processing = lazyPage(() => import('./Processing'))

export const analysisRoutes = [
  ...dualRoutes(
    'vakalar/:id/isleme',
    'cases/:id/processing',
    <Gate roles={['vet', 'expert']}><Processing /></Gate>,
  ),
]
