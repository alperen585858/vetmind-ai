import { useState } from 'react'
import { Ban, Loader2, Trash2 } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { Button } from '../../shared/ui/Button'
import { Modal } from '../../shared/ui/Modal'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { cancelBackendCase, deleteBackendCase } from '../../shared/api'
import type { VetCase } from '../../shared/types'

/** Drafts that have not reached a radiologist (mirrors CaseService.is_cancellable). */
export function isCancellable(c: VetCase): boolean {
  if (c.status === 'taslak') return true
  return c.status === 'analiz_basarisiz' && !c.assignedReviewerId && !c.backendDraft
}

/**
 * #78: the clinic cancels a draft (kept, reason recorded); only an administrator can
 * delete permanently (e.g. a KVKK erasure request), also with a reason.
 */
export function CaseCancelActions({ c }: { c: VetCase }) {
  const { role, hydrateBackendCase, removeCase, pushToast } = useApp()
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const [mode, setMode] = useState<'cancel' | 'delete' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const caseKey = c.backendCaseId || c.id
  if (!caseKey.startsWith('case-')) return null

  const canCancel = (role === 'vet' || role === 'clinic_owner' || role === 'admin') && isCancellable(c)
  const canDelete = role === 'admin'
  if (!canCancel && !canDelete) return null

  const close = () => {
    if (busy) return
    setMode(null)
    setReason('')
  }

  const submit = async () => {
    const why = reason.trim()
    if (why.length < 3 || !mode) return
    setBusy(true)
    try {
      if (mode === 'cancel') {
        await cancelBackendCase(caseKey, why)
        await hydrateBackendCase(caseKey)
        pushToast({ tone: 'success', title: t('cases.cancel.done'), body: c.patient.name })
      } else {
        await deleteBackendCase(caseKey, why)
        removeCase(c.id)
        pushToast({ tone: 'success', title: t('cases.cancel.deleted'), body: c.patient.name })
        nav('/vakalar')
      }
      setMode(null)
      setReason('')
    } catch (err) {
      pushToast({ tone: 'error', title: t('cases.cancel.failed'), body: toastErrorBody(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {canCancel && (
        <Button variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => setMode('cancel')}>
          {t('cases.cancel.button')}
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setMode('delete')}>
          {t('cases.cancel.deleteButton')}
        </Button>
      )}
      <Modal
        open={mode !== null}
        onClose={close}
        title={mode === 'delete' ? t('cases.cancel.deleteTitle') : t('cases.cancel.title')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim().length < 3}
              icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              onClick={() => void submit()}
            >
              {mode === 'delete' ? t('cases.cancel.deleteConfirm') : t('cases.cancel.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>{mode === 'delete' ? t('cases.cancel.deleteBody') : t('cases.cancel.body')}</p>
          <label className="block">
            <span className="label">{t('cases.cancel.reason')} *</span>
            <textarea
              className="input mt-1 min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('cases.cancel.reasonPlaceholder')}
              maxLength={500}
              autoFocus
            />
          </label>
        </div>
      </Modal>
    </>
  )
}
