import type { Dispatch, SetStateAction } from 'react'
import { Lightbulb } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { NORMAL_NEURO, NOT_EVALUATED } from '../../../shared/lib/neuroExam'
import type { LocalizationHint } from '../../../shared/lib/neuroLocalization'
import type { NeuroExam } from '../../../shared/types'
import { CN, EMPTY_NEURO, LIMBS } from './constants'
import { Checks, Field, Pills } from './fields'

export function NeuroStep({
  neuro,
  setNeuro,
  hint,
}: {
  neuro: NeuroExam
  setNeuro: Dispatch<SetStateAction<NeuroExam>>
  hint: LocalizationHint | null
}) {
  const N = <K extends keyof NeuroExam>(k: K, v: NeuroExam[K]) => setNeuro((n) => ({ ...n, [k]: v }))
  return (
    <div className="grid animate-fade-up gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy-900">Nörolojik Muayene Formu</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setNeuro(NORMAL_NEURO)}>
              Muayene normal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNeuro(EMPTY_NEURO)}>
              Temizle
            </Button>
          </div>
        </div>
        <Field label="Bilinç durumu"><Pills options={['Uyanık', 'Depresif', 'Stupor', 'Koma', NOT_EVALUATED] as const} value={neuro.consciousness} onChange={(v) => N('consciousness', v)} /></Field>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Yürüyüş"><Pills options={['Normal', 'Ataksi', 'Parezi', 'Pleji', NOT_EVALUATED] as const} value={neuro.gait} onChange={(v) => N('gait', v)} /></Field>
          <Field label="Etkilenen bacaklar"><Checks options={LIMBS} value={neuro.limbs} onChange={(v) => N('limbs', v)} /></Field>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Postüral reaksiyonlar — ön bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok', NOT_EVALUATED] as const} value={neuro.posturalThoracic} onChange={(v) => N('posturalThoracic', v)} /></Field>
          <Field label="Postüral reaksiyonlar — arka bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok', NOT_EVALUATED] as const} value={neuro.posturalPelvic} onChange={(v) => N('posturalPelvic', v)} /></Field>
          <Field label="Spinal refleksler — torasik"><Pills options={['Normal', 'Azalmış', 'Artmış', NOT_EVALUATED] as const} value={neuro.reflexThoracic} onChange={(v) => N('reflexThoracic', v)} /></Field>
          <Field label="Spinal refleksler — pelvik"><Pills options={['Normal', 'Azalmış', 'Artmış', NOT_EVALUATED] as const} value={neuro.reflexPelvic} onChange={(v) => N('reflexPelvic', v)} /></Field>
        </div>
        <Field label="Kraniyal sinirler">
          <div className="space-y-2">
            <Pills
              options={['Normal', 'Bulgu var', NOT_EVALUATED] as const}
              value={neuro.cranialNervesStatus}
              onChange={(v) => setNeuro((n) => ({ ...n, cranialNervesStatus: v, cranialNerves: v === 'Bulgu var' ? n.cranialNerves : [] }))}
            />
            {neuro.cranialNervesStatus === 'Bulgu var' && (
              <Checks options={CN} value={neuro.cranialNerves} onChange={(v) => N('cranialNerves', v)} />
            )}
          </div>
        </Field>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Ağrı algısı (derin ağrı)"><Pills options={['Var', 'Yok', NOT_EVALUATED] as const} value={neuro.deepPain} onChange={(v) => N('deepPain', v)} /></Field>
          <Field label="Spinal hiperestezi bölgesi"><Pills options={['Yok', 'Servikal', 'Torakolomber', 'Lumbosakral', NOT_EVALUATED] as const} value={neuro.hyperesthesia} onChange={(v) => N('hyperesthesia', v)} /></Field>
        </div>
      </div>
      <div>
        <div className="sticky top-24 rounded-xl border border-teal-200 bg-gradient-to-b from-teal-50 to-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
            <Lightbulb className="h-4 w-4" /> Olası lezyon lokalizasyonu
          </div>
          {hint ? (
            <>
              <p className="mt-3 text-2xl font-bold text-navy-900">{hint.region}</p>
              <p className="mt-2 text-sm text-navy-700">{hint.text}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Muayene bulgularını işaretledikçe olası lokalizasyon burada gösterilecek.</p>
          )}
          {neuro.deepPain === 'Değerlendirilmedi' && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">Derin ağrı algısı değerlendirilmedi olarak işaretli. Bu bilgi prognoz için önemlidir.</p>
          )}
        </div>
      </div>
    </div>
  )
}
