import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { useLocale } from '../shell/LocaleContext'

/**
 * Catches render errors so one broken page does not blank the whole app (#124).
 * `resetKey` (e.g. the pathname) clears the error when the user navigates elsewhere.
 * Missing chunks after a deploy are handled in lazyPage (one automatic reload).
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; fullScreen?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[VetMind] page crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <CrashCard fullScreen={this.props.fullScreen} />
  }
}

function CrashCard({ fullScreen = false }: { fullScreen?: boolean }) {
  const { t } = useLocale()
  return (
    <div className={`flex items-center justify-center p-6 ${fullScreen ? 'min-h-screen bg-slate-50' : 'min-h-[50vh]'}`}>
      <div role="alert" className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold text-slate-900">{t('common.crashTitle')}</h1>
        <p className="mt-1.5 text-sm text-slate-600">{t('common.crashBody')}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> {t('common.crashReload')}
          </button>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
          >
            <Home className="h-4 w-4" aria-hidden /> {t('common.crashHome')}
          </button>
        </div>
      </div>
    </div>
  )
}
