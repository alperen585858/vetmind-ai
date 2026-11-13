import { ArrowLeft, Compass, Home, LogIn } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Logo } from '../components/Logo'
import { useLocale } from '../context/LocaleContext'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'

/**
 * 404 for unknown routes (issue #28). ``public`` = signed-out (standalone page with
 * landing / login links); ``app`` = signed-in (inside the layout, back to the dashboard).
 */
export default function NotFound({ variant }: { variant: 'public' | 'app' }) {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const { pathname } = useLocation()

  const body = (
    <EmptyState
      icon={<Compass className="h-6 w-6" />}
      title={t('notFound.title')}
      text={t(variant === 'app' ? 'notFound.textApp' : 'notFound.textPublic')}
      action={
        <div className="flex flex-col items-center gap-3">
          <code className="max-w-xs truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-500" title={pathname}>
            {pathname}
          </code>
          <div className="flex flex-wrap justify-center gap-2">
            {variant === 'app' ? (
              <>
                <Button size="sm" icon={<Home className="h-4 w-4" />} onClick={() => nav('/')}>
                  {t('notFound.backToDashboard')}
                </Button>
                <Button size="sm" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav(-1)}>
                  {t('notFound.goBack')}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" icon={<Home className="h-4 w-4" />} onClick={() => nav('/')}>
                  {t('notFound.backToHome')}
                </Button>
                <Button size="sm" variant="secondary" icon={<LogIn className="h-4 w-4" />} onClick={() => nav('/giris')}>
                  {t('notFound.login')}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    />
  )

  if (variant === 'app') {
    return <Card className="mx-auto mt-8 max-w-xl">{body}</Card>
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4">
      <Logo />
      <Card className="w-full max-w-md">{body}</Card>
    </main>
  )
}
