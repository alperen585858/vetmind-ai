import { lazyPage } from '../../lib/lazyPage'
import { dualRoutes, Gate } from '../../shared/shell/routing'

const AiLessons = lazyPage(() => import('./AiLessons'))
const Modules = lazyPage(() => import('./Modules'))
const KnowledgeBase = lazyPage(() => import('./KnowledgeBase'))

export const ragAdminRoutes = [
  ...dualRoutes('ai-dersleri', 'ai-lessons', <Gate roles={['expert', 'admin']}><AiLessons /></Gate>),
  ...dualRoutes('moduller', 'modules', <Gate roles={['admin']}><Modules /></Gate>),
  ...dualRoutes('bilgi-tabani', 'knowledge-base', <Gate roles={['admin']}><KnowledgeBase /></Gate>),
]
