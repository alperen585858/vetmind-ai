import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { FileText, Trash2, UploadCloud } from 'lucide-react'
import type { DocType } from '../../../shared/types'
import { DOC_TYPES, type UploadFile } from './constants'

export function DocumentIntake({
  files,
  setFiles,
  onAddFiles,
}: {
  files: UploadFile[]
  setFiles: Dispatch<SetStateAction<UploadFile[]>>
  onAddFiles: (list: FileList | null) => void
}) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
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
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/40'
        }`}
      >
        <UploadCloud className="h-10 w-10 text-teal-600" />
        <p className="mt-3 font-medium text-navy-900">Dosyaları buraya sürükleyin veya seçmek için tıklayın</p>
        <p className="mt-1 text-xs text-slate-500">
          PDF, JPG, PNG, TXT · backend quarantine + metin çıkarma · tanı değil (pipeline: Doküman / multimodal)
        </p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => onAddFiles(e.target.files)} />
      </div>
      {files.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {files.map((f) => (
            <li key={f.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-3">
                <div className="rounded-lg bg-rose-50 p-2 text-rose-600"><FileText className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-medium text-navy-900">{f.name}</p>
                  <p className="text-xs text-slate-500">{f.size}</p>
                </div>
              </div>
              <select className="input sm:w-52" value={f.type} onChange={(e) => setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, type: e.target.value as DocType } : x)))}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))} className="self-end rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:self-auto">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
