import { useLocalizedNavigate } from '../../../hooks/useLocalizedNavigate'
import { FileText } from 'lucide-react'
import { useLocale } from '../../../context/LocaleContext'
import { Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { CitedText } from '../../../components/CitedText'
import { GroundingWarnings } from '../../../components/GroundingWarnings'
import type { VetCase } from '../../../types'

export function ReportWorkspace({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const draft = c.backendDraft
  const prov = draft
    ? `${draft.generation?.model_id ?? '—'} · v${draft.version ?? c.currentReportVersion ?? '—'}${draft.immutable ? ' · immutable' : ''}`
    : null

  if (!draft && !c.aiDraft && !c.report) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={t('cases.detail.noReportYet')}
          text={t('cases.detail.noReportYetBody')}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-navy-900">{t('cases.detail.reportStatus')}</p>
            <p className="mt-1 text-xs text-slate-600">
              {draft?.status ?? c.status}
              {draft?.expert_review_status ? ` · review=${draft.expert_review_status}` : ''}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">{prov}</p>
            {draft?.synthetic !== false && (
              <p className="mt-2 text-xs font-semibold text-amber-800">{t('cases.detail.aiDraftNotCertified')}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.status === 'onaylandi' && (
              <Button size="sm" onClick={() => nav(`/raporlar/${c.id}`)}>
                Print / PDF
              </Button>
            )}
            {c.status === 'uzman_incelemesinde' && (
              <Button size="sm" variant="secondary" onClick={() => nav(`/vakalar/${c.id}/calisma`)}>
                Uzman inceleme
              </Button>
            )}
          </div>
        </div>
      </Card>
      <GroundingWarnings warnings={draft?.validation_warnings} checked={Boolean(draft?.generation.prompt_version)} />
      {(draft || c.report || c.aiDraft) && (
        <Card className="p-5">
          <dl className="space-y-4 text-sm">
            {[
              [t('cases.detail.secTechnique'), draft?.technique?.text ?? c.report?.klinikOzet ?? c.aiDraft?.klinikOzet],
              [t('cases.detail.secFindings'), draft?.findings?.text ?? c.report?.bulgular ?? c.aiDraft?.bulgular],
              [t('cases.detail.secImpression'), draft?.impression?.text ?? c.report?.degerlendirme ?? c.aiDraft?.degerlendirme],
              [t('cases.detail.secRecommendations'), draft?.recommendations?.text ?? c.report?.oneriler ?? c.aiDraft?.oneriler],
            ].map(([label, text]) =>
              text ? (
                <div key={String(label)}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{label}</dt>
                  <dd className="mt-1">
                    <CitedText
                      text={String(text)}
                      citationMap={draft?.citation_map}
                      sources={draft?.rag_citations}
                      findings={c.backendFindings?.findings}
                      className="text-navy-900"
                    />
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </Card>
      )}
    </div>
  )
}
