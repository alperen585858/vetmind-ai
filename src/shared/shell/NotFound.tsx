import { ArrowLeft, Compass, Home, LogIn } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Logo } from '../../components/Logo'
import { useLocale } from '../../context/LocaleContext'
import { useLocalizedNavigate } from '../../hooks/useLocalizedNavigate'

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
          <code className="max-w-xs truncate rounded-lg bg-slate-100/90 px-2.5 py-1.5 font-mono text-xs text-slate-500 ring-1 ring-inset ring-slate-200" title={pathname}>
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
    return <Card className="mx-auto mt-8 max-w-xl overflow-hidden">{body}</Card>
  }
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-navy-950 px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-10 h-[420px] w-[420px] rounded-full bg-teal-600/20 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-6">
        <Logo dark size="lg" />
        <Card className="w-full max-w-md overflow-hidden border-navy-800 bg-white shadow-xl">
          {body}
        </Card>
      </div>
    </main>
  )
}
