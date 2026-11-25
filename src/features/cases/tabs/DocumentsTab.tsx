import { useRef, useState } from 'react'
import { CheckCircle2, FilePlus2, FileText } from 'lucide-react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import { attachCaseDocument, uploadDocuments } from '../../../shared/api'
import type { VetCase } from '../../../shared/types'

/** Add supporting documents (PDF, image, text) to an existing case; never creates a new case (#70). */
function AddDocumentButton({ c }: { c: VetCase }) {
  const { pushToast, hydrateBackendCase } = useApp()
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const caseKey = c.backendCaseId || c.id

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    try {
      const up = await uploadDocuments({
        files: Array.from(list),
        patientName: c.patient.name,
        species: c.patient.species,
        breed: c.patient.breed,
        clinicalHistory: c.clinical.history || c.clinical.complaint,
      })
      await attachCaseDocument(caseKey, up.ingest_id)
      await hydrateBackendCase(caseKey)
      pushToast({ tone: 'success', title: t('cases.detail.toastDocAttached'), body: t('cases.detail.toastDocAttachedBody') })
    } catch (e) {
      pushToast({ tone: 'error', title: t('cases.detail.toastDocFailed'), body: toastErrorBody(e, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<FilePlus2 className="h-4 w-4" />}
        disabled={busy}
        data-testid="add-document"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? t('common.loading') : t('cases.detail.addDocument')}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/*"
        className="hidden"
        data-testid="add-document-input"
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </>
  )
}

export function Documents({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const { role } = useApp()
  const [sel, setSel] = useState(c.documents[0]?.id)
  const doc = c.documents.find((d) => d.id === sel) ?? c.documents[0]
  const caseKey = c.backendCaseId || c.id
  const canAdd =
    (role === 'vet' || role === 'clinic_owner' || role === 'expert') && c.fromBackend === true && caseKey.startsWith('case-')
  const addButton = canAdd ? <AddDocumentButton c={c} /> : null

  if (!c.documents.length) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={t('cases.detail.noDocuments')}
          text={canAdd ? t('cases.detail.documentsHint') : t('cases.detail.caseIsDraft')}
          action={addButton ?? undefined}
        />
      </Card>
    )
  }
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-3">
        <CardHeader title={t('cases.detail.documentsCount', { count: c.documents.length })} />
        {addButton ? <div className="px-4 pb-2">{addButton}</div> : null}
        <ul className="p-2">
          {c.documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => setSel(d.id)} className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${doc?.id === d.id ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : 'hover:bg-slate-50'}`}>
                <FileText className={`mt-0.5 h-5 w-5 shrink-0 ${doc?.id === d.id ? 'text-teal-600' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.size}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {t('cases.detail.processed')}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {doc && (
        <>
          <Card className={doc.extracted.length ? 'lg:col-span-5' : 'lg:col-span-9'}>
            <CardHeader title={t('cases.detail.rawText')} subtitle={t('cases.detail.rawTextSub', { name: doc.name })} />
            {doc.rawText ? (
              <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-mono text-[12.5px] leading-relaxed text-navy-800">{doc.rawText}</pre>
            ) : (
              <p className="p-5 text-sm text-slate-500">{t('cases.detail.noExtractedText')}</p>
            )}
          </Card>
          {doc.extracted.length > 0 && (
            <Card className="lg:col-span-4">
              <CardHeader title={t('cases.detail.extractedData')} subtitle={t('cases.detail.extractedDataSub')} />
              <ul className="space-y-3 p-4">
                {doc.extracted.map((e, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{e.field}</p>
                    <p className="mt-0.5 text-sm font-medium text-navy-900">{e.value}</p>
                    <p className="mt-2 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">{t('cases.detail.sourceSentence')} {e.source}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
