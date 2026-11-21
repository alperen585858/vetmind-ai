import { lazyPage } from '../../lib/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const Messages = lazyPage(() => import('./Messages'))

const messageRoles = ['owner', 'expert', 'admin', 'vet', 'clinic_owner'] as const

export const messagingRoutes = [
  ...dualRoutes('mesajlar', 'messages', <Gate roles={[...messageRoles]}><Messages /></Gate>),
  ...dualRoutes(
    'mesajlar/:threadId',
    'messages/:threadId',
    <Gate roles={[...messageRoles]}><Messages /></Gate>,
  ),
]
