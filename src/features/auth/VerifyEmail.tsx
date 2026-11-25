import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react'
import { AuthCard } from '../../shared/ui/AuthCard'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocale } from '../../shared/shell/LocaleContext'
import {
  BackendUnavailableError,
  backendVerifyEmail,
  type BackendVerifyEmailResponse,
} from '../../shared/api'
import { ResendVerification } from './ResendVerification'

// One request per token, kept outside React: StrictMode and remounts would otherwise send
// the single-use token twice and show "link already used" right after it worked.
let pending: { token: string; promise: Promise<BackendVerifyEmailResponse> } | null = null

function verifyOnce(token: string): Promise<BackendVerifyEmailResponse> {
  if (pending?.token !== token) pending = { token, promise: backendVerifyEmail(token) }
  return pending.promise
}

type State =
  | { kind: 'loading' }
  | { kind: 'done'; result: BackendVerifyEmailResponse }
  | { kind: 'failed'; offline: boolean }
  | { kind: 'missing' }

/**
 * Opened from the emailed link (/eposta-dogrula?token=…). Like the reset page, the token is
 * read once, removed from the address bar, and the page sends no Referer.
 */
export default function VerifyEmail() {
  const { t } = useLocale()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? pending?.token ?? '')
  const [state, setState] = useState<State>(() => (token ? { kind: 'loading' } : { kind: 'missing' }))

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    if (window.location.search.includes('token=')) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
    return () => meta.remove()
  }, [])

  useEffect(() => {
    if (!token) return
    let alive = true
    verifyOnce(token).then(
      (result) => alive && setState({ kind: 'done', result }),
      (err) => alive && setState({ kind: 'failed', offline: err instanceof BackendUnavailableError }),
    )
    return () => {
      alive = false
    }
  }, [token])

  if (state.kind === 'loading') {
    return (
      <AuthCard icon={<Loader2 className="h-5 w-5 animate-spin" />} title={t('auth.verifyTitle')}>
        <p className="text-sm text-navy-200" role="status">
          {t('auth.verifyChecking')}
        </p>
      </AuthCard>
    )
  }

  if (state.kind === 'done') {
    return (
      <AuthCard icon={<CheckCircle2 className="h-5 w-5" />} title={t('auth.verifyDoneTitle')}>
        <p className="text-sm text-navy-200" role="status">
          {state.result.pending_approval ? t('auth.verifyDonePending') : t('auth.verifyDoneActive')}
        </p>
        <p className="mt-3 font-mono text-xs text-navy-400">{state.result.email}</p>
        <LocalizedLink to="/giris" className="mt-5 inline-flex text-sm font-semibold text-teal-300 hover:underline">
          {t('auth.backToLogin')}
        </LocalizedLink>
      </AuthCard>
    )
  }

  return (
    <AuthCard icon={<MailWarning className="h-5 w-5" />} title={t('auth.verifyTitle')}>
      <p className="text-sm text-navy-200" role="alert">
        {state.kind === 'missing'
          ? t('auth.verifyMissingToken')
          : state.offline
            ? t('auth.backendUnreachable')
            : t('auth.verifyLinkInvalid')}
      </p>
      <ResendVerification />
      <LocalizedLink to="/giris" className="mt-5 inline-flex text-sm font-semibold text-teal-300 hover:underline">
        {t('auth.backToLogin')}
      </LocalizedLink>
    </AuthCard>
  )
}
