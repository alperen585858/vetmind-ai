import { useRef, useState, type InputHTMLAttributes } from 'react'
import { CheckCircle2, FileText, FolderOpen, UploadCloud, XCircle } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { MAX_DICOM_FILES, MAX_DICOM_FILE_BYTES, MAX_DICOM_TOTAL_BYTES, MAX_VIEWER_FRAMES } from '../../../shared/lib/dicomFolder'

/** Drag-and-drop / file / folder picker for DICOM, with progress and the last rejection summary. */
export function DicomDropZone({
  busy,
  validating,
  uploadProgress,
  fileCount,
  lastRejectSummary,
  onDrop,
  onFiles,
  onCancel,
}: {
  busy: boolean
  validating: boolean
  uploadProgress: string | null
  fileCount: number
  lastRejectSummary: string | null
  onDrop: (dt: DataTransfer) => void
  onFiles: (list: FileList | null, sourceLabel: string) => void
  onCancel: () => void
}) {
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  return (
  <div
    onDragOver={(e) => {
      e.preventDefault()
      setDrag(true)
    }}
    onDragLeave={() => setDrag(false)}
    onDrop={(e) => {
      e.preventDefault()
      setDrag(false)
      onDrop(e.dataTransfer)
    }}
    className={`flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
      drag
        ? 'border-teal-600 bg-teal-50 shadow-inner'
        : 'border-teal-200/80 bg-gradient-to-b from-teal-50/70 via-white to-slate-50/40'
    }`}
  >
    <div
      className={`flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ${
        drag ? 'bg-teal-100 text-teal-700 ring-teal-200' : 'bg-white text-teal-600 ring-teal-100'
      }`}
    >
      <UploadCloud className="h-8 w-8" strokeWidth={1.75} />
    </div>
    <p className="mt-5 text-lg font-semibold tracking-tight text-navy-900">
      {drag ? 'Dosyaları bırakın' : 'DICOM dosya veya klasör sürükleyin'}
    </p>
    <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
      .dcm / DICOM Part-10 · en fazla {MAX_DICOM_FILES} dosya · dosya başına{' '}
      {Math.round(MAX_DICOM_FILE_BYTES / (1024 * 1024))} MiB · toplam{' '}
      {Math.round(MAX_DICOM_TOTAL_BYTES / (1024 * 1024))} MiB
    </p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Button
        type="button"
        icon={<FileText className="h-4 w-4" />}
        onClick={(e) => {
          e.stopPropagation()
          fileInputRef.current?.click()
        }}
      >
        Dosya seç
      </Button>
      <Button
        type="button"
        variant="secondary"
        icon={<FolderOpen className="h-4 w-4" />}
        onClick={(e) => {
          e.stopPropagation()
          folderInputRef.current?.click()
        }}
      >
        Klasör seç
      </Button>
    </div>
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept=".dcm,.dicom,application/dicom,*/*"
      className="hidden"
      onChange={(e) => {
        onFiles(e.target.files, 'Dosya seçimi')
        e.target.value = ''
      }}
    />
    <input
      ref={folderInputRef}
      type="file"
      className="hidden"
      multiple
      onChange={(e) => {
        onFiles(e.target.files, 'Klasör seçimi')
        e.target.value = ''
      }}
      {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
    />
    {(busy || uploadProgress || validating) && (
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <p className="flex items-center gap-2 text-xs font-medium text-teal-700">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600" />
          {uploadProgress ?? 'İşleniyor…'}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-200 hover:text-rose-700"
        >
          <XCircle className="h-3.5 w-3.5" />
          Analizi durdur
        </button>
      </div>
    )}
    {fileCount > 0 && (
      <p className="mt-4 flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {fileCount} dosya seçili
        {fileCount > MAX_VIEWER_FRAMES ? ` · görüntüleyici ilk ${MAX_VIEWER_FRAMES} kare` : ''}
      </p>
    )}
    {lastRejectSummary && <p className="mt-3 max-w-lg text-[11px] text-amber-800">{lastRejectSummary}</p>}
  </div>
  )
}
