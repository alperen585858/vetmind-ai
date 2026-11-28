import { useState } from 'react'
import { ChevronRight, EyeOff, History, Loader2, Sparkles, Square } from 'lucide-react'
import { LocalizedLink } from '../../../shared/shell/LocalizedLink'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import { Button } from '../../../shared/ui/Button'
import { appendCaseInternalNote, createCaseInfoRequest } from '../../../shared/api'
import type { ReportVersionRow } from './useWorkspaceData'

/** Collapsible "technical tools": AI resend, delete, version history, internal notes, info requests. */
export function TechToolsPanel({
  caseKey,
  immutable,
  saving,
  resendingAi,
  onResend,
  onStopResend,
  onDelete,
  versions,
}: {
  caseKey: string
  immutable: boolean
  saving: boolean
  resendingAi: boolean
  onResend: () => void
  onStopResend: () => void
  onDelete: () => void
  versions: ReportVersionRow[]
}) {
  const { pushToast } = useApp()
  const { t } = useLocale()
  const [internalNote, setInternalNote] = useState('')
  const [infoAsk, setInfoAsk] = useState('')
  const isBackendCase = caseKey.startsWith('case-')

  return (
    <details className="group rounded-vm border border-slate-200/80 bg-surface-elevated">
      <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold text-navy-900">{t('review.workspace.techTools')}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">{t('review.workspace.techToolsHint')}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90" aria-hidden />
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-4 py-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3.5 w-3.5" /> {t('review.workspace.resendSection')}
          </p>
          <p className="mb-3 text-xs text-slate-600">
            {t('review.workspace.resendBody')}{' '}
            <LocalizedLink to="/ai-tekrar" className="font-semibold text-teal-700 underline">
              {t('ai.resend.title')}
            </LocalizedLink>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={resendingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={resendingAi || !isBackendCase}
              onClick={onResend}
            >
              {resendingAi
                ? t('review.workspace.sending')
                : immutable
                  ? t('review.workspace.reviseOpenResend')
                  : t('review.workspace.resendThisCase')}
            </Button>
            {resendingAi && (
              <Button size="sm" variant="ghost" icon={<Square className="h-3.5 w-3.5" />} onClick={onStopResend}>
                {t('review.workspace.stopAnalysis')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-[color:var(--vm-danger)]"
              icon={<EyeOff className="h-3.5 w-3.5" />}
              onClick={onDelete}
            >
              {t('review.workspace.deleteCase')}
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <History className="h-3.5 w-3.5" /> {t('review.workspace.reportHistory')}
          </p>
          {versions.length === 0 ? (
            <p className="text-xs text-slate-500">{t('review.workspace.noVersions')}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {versions.map((v) => (
                <li key={v.version} className="flex justify-between rounded bg-slate-50 px-2 py-1">
                  <span>
                    v{v.version} · {v.status}
                  </span>
                  <span className={v.immutable ? 'text-emerald-700' : 'text-slate-500'}>
                    {v.immutable ? 'immutable' : 'mutable'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isBackendCase && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('review.workspace.internalNotes')}</p>
            <label className="block text-xs text-slate-600">
              {t('review.workspace.internalNoteLabel')}
              <textarea
                className="input mt-1 min-h-[56px] text-sm"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!internalNote.trim() || saving}
              onClick={() =>
                void appendCaseInternalNote(caseKey, internalNote.trim())
                  .then(() => {
                    setInternalNote('')
                    pushToast({ tone: 'success', title: t('review.workspace.toastInternalSaved') })
                  })
                  .catch((e) =>
                    pushToast({
                      tone: 'error',
                      title: t('review.workspace.toastInternalFailed'),
                      body: toastErrorBody(e, t),
                    }),
                  )
              }
            >
              {t('review.workspace.saveInternalNote')}
            </Button>
            <label className="block text-xs text-slate-600">
              {t('review.workspace.askVetInfo')}
              <input
                className="input mt-1 text-sm"
                value={infoAsk}
                onChange={(e) => setInfoAsk(e.target.value)}
                placeholder={t('review.workspace.requestPlaceholder')}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!infoAsk.trim()}
              onClick={() =>
                void createCaseInfoRequest(caseKey, { body: infoAsk.trim(), to_role: 'vet' })
                  .then(() => {
                    setInfoAsk('')
                    pushToast({ tone: 'info', title: t('review.workspace.toastInfoOpened') })
                  })
                  .catch((e) =>
                    pushToast({
                      tone: 'error',
                      title: t('review.workspace.toastRequestFailed'),
                      body: toastErrorBody(e, t),
                    }),
                  )
              }
            >
              {t('review.workspace.sendRequest')}
            </Button>
          </div>
        )}
      </div>
    </details>
  )
}
