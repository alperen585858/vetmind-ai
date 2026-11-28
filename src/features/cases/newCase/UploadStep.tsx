import type { ReactNode } from 'react'
import { Brain } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Button } from '../../../shared/ui/Button'
import type { DicomDemoKind } from '../../../shared/types'
import type { IntakeMode } from '../lib/analysisChannel'

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${active ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300'}`}
    >
      {children}
    </button>
  )
}

/** Step 4 of New Case: pick documents or DICOM, then the matching intake panel. */
export function UploadStep({
  intakeMode,
  onSelectDocuments,
  onSelectDicom,
  documents,
  dicom,
}: {
  intakeMode: IntakeMode
  onSelectDocuments: () => void
  onSelectDicom: () => void
  documents: ReactNode
  dicom: ReactNode
}) {
  const { t } = useLocale()
  return (
    <div className="animate-fade-up">
      <h2 className="mb-1 text-lg font-semibold text-navy-900">{t('cases.stepUpload')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('newCase.uploadIntro')}</p>
      <div className="mb-5 flex flex-wrap gap-2">
        <ModeButton active={intakeMode === 'documents'} onClick={onSelectDocuments}>
          {t('newCase.intakeDocuments')}
        </ModeButton>
        <ModeButton active={intakeMode === 'dicom'} onClick={onSelectDicom}>
          {t('newCase.intakeDicom')}
        </ModeButton>
      </div>
      {intakeMode === 'documents' ? documents : dicom}
    </div>
  )
}

/** Demo-only quick fill buttons (VITE_ENABLE_DEMO_FIXTURES=1, issue #95). */
export function DemoQuickFill({
  onBrain,
  onCervical,
  onDicomDemo,
}: {
  onBrain: () => void
  onCervical: () => void
  onDicomDemo: (kind: DicomDemoKind) => void
}) {
  const { t } = useLocale()
  return (
    <details className="mb-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <summary className="cursor-pointer font-medium text-navy-800">{t('cases.quickFill')}</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Brain className="h-3.5 w-3.5 text-teal-600" />} onClick={onBrain}>
          Brain MRI
        </Button>
        <Button size="sm" variant="secondary" onClick={onCervical}>
          Cervical MRI
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onDicomDemo('brain_mri')}>
          DICOM · Brain
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onDicomDemo('cervical_mri')}>
          DICOM · Cervical
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onDicomDemo('brain_ct')}>
          DICOM · CT
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onDicomDemo('thorax_xr')}>
          DICOM · XR
        </Button>
      </div>
    </details>
  )
}
