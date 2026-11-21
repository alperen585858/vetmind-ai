import { useState } from 'react'
import { CheckCircle2, FileText } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { EmptyState } from '../../../shared/ui/EmptyState'
import type { VetCase } from '../../../shared/types'

export function Documents({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const [sel, setSel] = useState(c.documents[0]?.id)
  const doc = c.documents.find((d) => d.id === sel)
  if (!c.documents.length) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title={t('cases.detail.noDocuments')} text={t('cases.detail.caseIsDraft')} /></Card>
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-3">
        <CardHeader title={`Belgeler (${c.documents.length})`} />
        <ul className="p-2">
          {c.documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => setSel(d.id)} className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${sel === d.id ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : 'hover:bg-slate-50'}`}>
                <FileText className={`mt-0.5 h-5 w-5 shrink-0 ${sel === d.id ? 'text-teal-600' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.pages} sf · {d.size}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {t('cases.detail.processed')}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {doc && (
        <>
          <Card className="lg:col-span-5">
            <CardHeader title={t('cases.detail.rawText')} subtitle={t('cases.detail.rawTextSub', { name: doc.name })} />
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-mono text-[12.5px] leading-relaxed text-navy-800">{doc.rawText}</pre>
          </Card>
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
        </>
      )}
    </div>
  )
}
