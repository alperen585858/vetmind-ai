import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const AdminUsers = lazyPage(() => import('./AdminUsers'))
const AdminRadiologists = lazyPage(() => import('./AdminRadiologists'))
const SystemStatus = lazyPage(() => import('./SystemStatus'))
const ModelPerformance = lazyPage(() => import('./ModelPerformance'))

export const adminRoutes = [
  ...dualRoutes('kullanicilar', 'users', <Gate roles={['admin']}><AdminUsers /></Gate>),
  ...dualRoutes('radyologlarim', 'my-radiologists', <Gate roles={['admin']}><AdminRadiologists /></Gate>),
  ...dualRoutes('sistem', 'system', <Gate roles={['admin']}><SystemStatus /></Gate>),
  ...dualRoutes(
    'model-performansi',
    'model-performance',
    <Gate roles={['admin']}><ModelPerformance /></Gate>,
  ),
]
