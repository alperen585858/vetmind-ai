import { Bone, Brain, FileText, Scan } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import type { DicomDemoKind } from '../../../shared/types'

export const DEMO_SETS: {
  kind: DicomDemoKind
  label: string
  hint: string
  tone: string
  Icon: typeof Brain
}[] = [
  { kind: 'brain_mri', label: 'Brain MRI', hint: 'MR · kranial', tone: 'from-teal-50 to-cyan-50 text-teal-700', Icon: Brain },
  { kind: 'cervical_mri', label: 'Cervical MRI', hint: 'MR · servikal', tone: 'from-sky-50 to-indigo-50 text-sky-700', Icon: Bone },
  { kind: 'thoracolumbar_mri', label: 'Thoracolumbar MRI', hint: 'MR · torakolomber', tone: 'from-emerald-50 to-teal-50 text-emerald-700', Icon: Bone },
  { kind: 'brain_ct', label: 'Brain CT', hint: 'BT · kranial', tone: 'from-violet-50 to-slate-50 text-violet-700', Icon: Scan },
  { kind: 'thorax_xr', label: 'Thorax XR', hint: 'Röntgen · toraks', tone: 'from-amber-50 to-orange-50 text-amber-700', Icon: FileText },
]

/** Sample DICOM sets (test fixtures only, issue #95: VITE_ENABLE_DEMO_FIXTURES=1). */
export function DemoDicomSets({
  pendingDemo,
  busy,
  onPreview,
  onUse,
}: {
  pendingDemo: DicomDemoKind | null
  busy: boolean
  onPreview: (kind: DicomDemoKind) => void
  onUse: (kind: DicomDemoKind) => void
}) {
  return (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-navy-900">Örnek veri setleri</h2>
        <p className="mt-0.5 text-sm text-slate-500">Hızlı deneme için hazır DICOM setleri</p>
      </div>
      {pendingDemo && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onPreview(pendingDemo)}>
          Metadata önizle
        </Button>
      )}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {DEMO_SETS.map((d) => {
        const selected = pendingDemo === d.kind
        return (
          <div
            key={d.kind}
            className={`overflow-hidden rounded-xl border bg-white transition ${
              selected ? 'border-teal-400 shadow-md shadow-teal-700/10 ring-1 ring-teal-200' : 'border-slate-200 hover:border-teal-200 hover:shadow-sm'
            }`}
          >
            <div className={`flex h-20 items-center justify-center bg-gradient-to-br ${d.tone}`}>
              <d.Icon className="h-9 w-9 opacity-80" strokeWidth={1.5} />
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold text-navy-900">{d.label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{d.hint}</p>
              <Button
                size="sm"
                variant={selected ? 'primary' : 'secondary'}
                className="mt-3 w-full"
                disabled={busy}
                aria-label={`${d.label} — ${selected ? 'Seçildi' : 'Kullan'}`}
                onClick={() => onUse(d.kind)}
              >
                {selected ? 'Seçildi' : 'Kullan'}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  </div>
  )
}
