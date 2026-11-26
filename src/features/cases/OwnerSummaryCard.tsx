import { useEffect, useState } from 'react'
import { CheckCircle2, Download, FileHeart, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'
import { Card, CardHeader } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useApp } from '../../shared/shell/AppContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import {
  approveOwnerSummary,
  downloadOwnerSummaryPdf,
  generateOwnerSummary,
  getOwnerSummary,
  saveOwnerSummary,
  type OwnerSummaryState,
} from '../../shared/api'

/** "model_text_rejected:dose" → "dose"; plain reasons pass through. */
export function warningKey(warning: string): string {
  return warning.startsWith('model_text_rejected:') ? warning.slice('model_text_rejected:'.length) : warning
}

/**
 * Issue #113 — case page: plain-language note for the pet owner. The vet creates it from the
 * approved report, edits, approves and prints it. Radiologists only read it.
 */
export function OwnerSummaryCard({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const { t, locale } = useLocale()
  const { pushToast } = useApp()
  const [state, setState] = useState<OwnerSummaryState | null>(null)
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<'tr' | 'en'>(locale === 'en' ? 'en' : 'tr')
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'approve' | 'pdf'>(null)
  const [failed, setFailed] = useState(false)

  const apply = (next: OwnerSummaryState) => {
    setState(next)
    setText(next.summary?.text ?? '')
  }

  useEffect(() => {
    setFailed(false)
    getOwnerSummary(caseId)
      .then(apply)
      .catch(() => setFailed(true))
  }, [caseId])

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>, failKey: string) => {
    setBusy(kind)
    try {
      await action()
    } catch (err) {
      pushToast({ tone: 'error', title: t(failKey), body: toastErrorBody(err, t) })
    } finally {
      setBusy(null)
    }
  }

  if (failed) return null
  if (!state) {
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('ownerSummary.loading')}
        </p>
      </Card>
    )
  }

  const s = state.summary
  const dirty = Boolean(s && text.trim() !== s.text.trim())
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Card className="p-5">
      <CardHeader title={t('ownerSummary.title')} subtitle={t('ownerSummary.subtitle')} icon={<FileHeart className="h-5 w-5" />} />

      {!state.report_approved ? (
        <p className="text-sm text-slate-600">{t('ownerSummary.needsApproval')}</p>
      ) : !s ? (
        canWrite ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label">{t('ownerSummary.language')}</span>
              <select className="input mt-1" value={language} onChange={(e) => setLanguage(e.target.value as 'tr' | 'en')}>
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
            </label>
            <Button
              icon={<Sparkles className="h-4 w-4" />}
              disabled={busy !== null}
              onClick={() =>
                void run('generate', async () => apply(await generateOwnerSummary(caseId, language)), 'ownerSummary.generateFailed')
              }
            >
              {busy === 'generate' ? t('ownerSummary.generating') : t('ownerSummary.generate')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t('ownerSummary.none')}</p>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${
                s.status === 'approved' && !state.stale ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {s.status === 'approved' ? t('ownerSummary.approved') : t('ownerSummary.draft')}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
              {s.source === 'llm' ? t('ownerSummary.sourceLlm') : t('ownerSummary.sourceTemplate')}
            </span>
            {s.edited && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{t('ownerSummary.edited')}</span>}
            {s.approved_at && s.status === 'approved' && (
              <span className="text-slate-500">{t('ownerSummary.approvedAt', { date: fmt.format(new Date(s.approved_at)) })}</span>
            )}
          </div>

          {state.stale && (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              {t('ownerSummary.stale')}
            </p>
          )}
          {s.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200" role="alert">
              {[...new Set(s.warnings)].map((w) => (
                <li key={w}>
                  {w.startsWith('model_text_rejected:') ? t('ownerSummary.rejected') + ' ' : ''}
                  {t(`ownerSummary.warning.${warningKey(w)}`)}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <textarea
              className="input min-h-[260px] w-full text-sm leading-relaxed"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={6000}
              aria-label={t('ownerSummary.textLabel')}
            />
          ) : (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{s.text}</p>
          )}
          <p className="text-xs text-slate-500">{state.disclaimer}</p>

          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {dirty && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Save className="h-3.5 w-3.5" />}
                  disabled={busy !== null}
                  onClick={() => void run('save', async () => apply(await saveOwnerSummary(caseId, text)), 'ownerSummary.saveFailed')}
                >
                  {busy === 'save' ? t('common.loading') : t('ownerSummary.save')}
                </Button>
              )}
              {s.status === 'draft' && !dirty && !state.stale && (
                <Button
                  size="sm"
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  disabled={busy !== null}
                  onClick={() =>
                    void run('approve', async () => {
                      apply(await approveOwnerSummary(caseId))
                      pushToast({ tone: 'success', title: t('ownerSummary.approvedToast') })
                    }, 'ownerSummary.approveFailed')
                  }
                >
                  {t('ownerSummary.approve')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                disabled={busy !== null}
                onClick={() =>
                  void run('generate', async () => apply(await generateOwnerSummary(caseId, s.language)), 'ownerSummary.generateFailed')
                }
              >
                {busy === 'generate' ? t('ownerSummary.generating') : t('ownerSummary.regenerate')}
              </Button>
            </div>
          )}
          {s.status === 'approved' && !state.stale && !dirty && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              disabled={busy !== null}
              onClick={() => void run('pdf', () => downloadOwnerSummaryPdf(caseId), 'ownerSummary.pdfFailed')}
            >
              {busy === 'pdf' ? t('common.loading') : t('ownerSummary.pdf')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
