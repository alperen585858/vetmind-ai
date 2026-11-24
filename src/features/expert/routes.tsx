import { lazyPage } from '../../shared/shell/lazyPage'
import { dualRoutes, ExpertCaseGate, ExpertReviewRedirect, Gate } from '../../shared/shell/routing'

const RadiologistWorkspace = lazyPage(() => import('./RadiologistWorkspace'))
const ReviewQueue = lazyPage(() => import('./ReviewQueue'))
const ExpertAiResend = lazyPage(() => import('./ExpertAiResend'))

export const expertRoutes = [
  ...dualRoutes(
    'vakalar/:id/inceleme',
    'cases/:id/review',
    <Gate roles={['expert']}><ExpertReviewRedirect /></Gate>,
  ),
  ...dualRoutes(
    'vakalar/:id/calisma',
    'cases/:id/workspace',
    <ExpertCaseGate><RadiologistWorkspace /></ExpertCaseGate>,
  ),
  ...dualRoutes('kuyruk', 'queue', <Gate roles={['expert']}><ReviewQueue /></Gate>),
  ...dualRoutes('ai-tekrar', 'ai-resend', <Gate roles={['expert']}><ExpertAiResend /></Gate>),
]
