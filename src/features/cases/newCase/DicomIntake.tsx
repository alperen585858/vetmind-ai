import { useRef, useState, type InputHTMLAttributes } from 'react'
import { FolderOpen, UploadCloud } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { confidenceLabel, studyLabel } from '../../../shared/lib/displayClean'
import { vhsSpeciesFrom } from '../../../shared/lib/vhs'
import { Button } from '../../../shared/ui/Button'
import { DicomViewer } from '../../../shared/dicom/DicomViewer'
import { SeriesExplorer } from '../../dicom/SeriesExplorer'
import type { DicomDemoKind, DicomUploadResponse, Patient } from '../../../shared/types'
import { DEMO_FIXTURES_ENABLED } from './constants'
import type { DicomViewerState } from './useDicomViewerState'

const DEMO_PREVIEWS: { kind: DicomDemoKind; label: string }[] = [
  { kind: 'brain_mri', label: 'Brain MRI' },
  { kind: 'cervical_mri', label: 'Cervical MRI' },
  { kind: 'thoracolumbar_mri', label: 'Thoracolumbar MRI' },
  { kind: 'brain_ct', label: 'Brain CT' },
  { kind: 'thorax_xr', label: 'Thorax XR' },
]

export function DicomIntake({
  species,
  dicomFiles,
  dicomPreview,
  viewer,
  submitting,
  imagingConsent,
  setImagingConsent,
  onAddFiles,
  onRemoveFile,
  onClearAll,
  onPreviewMetadata,
}: {
  species: Patient['species']
  dicomFiles: File[]
  dicomPreview: DicomUploadResponse | null
  viewer: DicomViewerState
  submitting: boolean
  imagingConsent: boolean
  setImagingConsent: (v: boolean) => void
  onAddFiles: (list: FileList | null) => void
  onRemoveFile: (file: File) => void
  onClearAll: () => void
  onPreviewMetadata: (kind?: DicomDemoKind) => void
}) {
  const { t } = useLocale()
  const [drag, setDrag] = useState(false)
  const dicomInputRef = useRef<HTMLInputElement>(null)
  const dicomFolderRef = useRef<HTMLInputElement>(null)
  const { frames, framesLoading } = viewer
  const isRadiograph =
    dicomPreview?.classification?.suggested_modality === 'XR' ||
    frames.some((f) => ['CR', 'DX', 'XR'].includes((f.modality ?? '').toUpperCase()))

  return (
    <>
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
        {t('newCase.dicomNote')}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          onAddFiles(e.dataTransfer.files)
        }}
        onClick={() => dicomInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/40'
        }`}
      >
        <UploadCloud className="h-10 w-10 text-teal-600" />
        <p className="mt-3 font-medium text-navy-900">{t('dicom.dropHint')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('newCase.dicomLimits')}</p>
        <input
          ref={dicomInputRef}
          type="file"
          multiple
          accept=".dcm,application/dicom,*/*"
          className="hidden"
          onChange={(e) => onAddFiles(e.target.files)}
        />
      </div>
      <input
        ref={dicomFolderRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onAddFiles(e.target.files)}
        {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={() => dicomFolderRef.current?.click()}>
          {t('dicom.selectFolder')}
        </Button>
        <Button variant="secondary" disabled={submitting || dicomFiles.length === 0} onClick={() => onPreviewMetadata()}>
          {submitting ? t('dicom.uploading') : t('newCase.previewMetadata')}
        </Button>
        {DEMO_FIXTURES_ENABLED &&
          DEMO_PREVIEWS.map(({ kind, label }) => (
            <Button key={kind} variant="secondary" disabled={submitting} onClick={() => onPreviewMetadata(kind)}>
              {label}
            </Button>
          ))}
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm leading-relaxed text-navy-800">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          checked={imagingConsent}
          onChange={(e) => setImagingConsent(e.target.checked)}
        />
        <span>{t('newCase.consentLabel')}</span>
      </label>
      {dicomFiles.length > 0 && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,32%)]">
          <div className="min-w-0">
            {framesLoading || frames.length > 0 ? (
              <DicomViewer
                frames={frames}
                loading={framesLoading}
                onActiveFrameChange={viewer.onActiveFrameChange}
                focusSopUid={viewer.focusSopUid}
                focusRequestId={viewer.focusRequestId}
                vhsEnabled={isRadiograph}
                vhsSpecies={vhsSpeciesFrom(species)}
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
                {t('newCase.viewerNoPixels')}
              </div>
            )}
          </div>
          <SeriesExplorer
            files={dicomFiles}
            frames={frames}
            study={dicomPreview?.study}
            activeSeriesKey={viewer.activeSeriesKey}
            activeSopUid={viewer.activeSopUid}
            onRemoveFile={onRemoveFile}
            onClearAll={onClearAll}
            onSelectInstance={viewer.selectInstance}
          />
        </div>
      )}
      {dicomPreview && <DicomPreviewCard preview={dicomPreview} />}
    </>
  )
}

function DicomPreviewCard({ preview }: { preview: DicomUploadResponse }) {
  const { t } = useLocale()
  return (
    <div className={`mt-5 rounded-xl border p-4 text-sm ${preview.blocked ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-teal-200 bg-teal-50/60 text-navy-900'}`}>
      <p className="font-semibold">{preview.blocked ? 'Ingest engellendi' : 'Metadata önizlemesi hazır'}</p>
      <p className="mt-1 text-xs opacity-80">ingest_id: {preview.ingest_id}</p>
      {preview.classification && (
        <p className="mt-2">
          Öneri:{' '}
          <strong>
            {studyLabel(t, preview.classification.suggested_modality, preview.classification.suggested_anatomical_region)}
          </strong>{' '}
          · {confidenceLabel(t, preview.classification.confidence)}
          {preview.classification.needs_confirmation ? ' · onay gerekli' : ''}
        </p>
      )}
      {preview.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {preview.issues.slice(0, 6).map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              [{issue.severity}] {issue.code}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
