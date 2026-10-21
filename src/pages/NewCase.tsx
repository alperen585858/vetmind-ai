import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Brain, FileText, Lightbulb, Pencil, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StepIndicator } from '../components/StepIndicator'
import { CLINIC, EMPTY_NEURO, SAMPLE_FORM } from '../data/mock'
import { buildAssessment, makeDocument } from '../data/templates'
import { localize } from '../lib/localization'
import { nowStamp, today } from '../lib/format'
import { AI_PHASE_START, PIPELINE_MS } from '../lib/pipeline'
import type { ClinicalInfo, DocType, NeuroExam, Patient, Priority, VetCase } from '../types'

const STEPS = ['Hasta Bilgileri', 'Klinik Bilgiler', 'Nörolojik Muayene', 'Tetkik Yükleme', 'Özet ve Gönder']
const DOC_TYPES: DocType[] = ['MR Raporu', 'BT Raporu', 'Laboratuvar Sonucu', 'Önceki Rapor']
const LIMBS = ['Sol ön', 'Sağ ön', 'Sol arka', 'Sağ arka']
const CN = ['Baş eğikliği', 'Nistagmus', 'Anizokori', 'Fasiyal paralizi', 'Tehdit refleksi kaybı']

const EMPTY_PATIENT: Patient = { name: '', species: 'Köpek', breed: '', sex: 'Erkek', neutered: false, age: 0, weight: 0, ownerName: '', ownerPhone: '' }
const EMPTY_CLINICAL: ClinicalInfo = { complaint: '', onset: 'Akut', course: 'Progresif', history: '', medications: '' }

interface UploadFile {
  id: string
  name: string
  type: DocType
  size: string
}

function guessType(name: string): DocType {
  const n = name.toLocaleLowerCase('tr')
  if (n.includes('mr')) return 'MR Raporu'
  if (n.includes('bt') || n.includes('ct') || n.includes('tomo')) return 'BT Raporu'
  if (n.includes('lab') || n.includes('kan') || n.includes('hemogram') || n.includes('biyokimya')) return 'Laboratuvar Sonucu'
  return 'Önceki Rapor'
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function Pills<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
            value === o ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Checks({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              on ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export default function NewCase() {
  const { addCase, cases, pushToast, updateCase } = useApp()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<Patient>(EMPTY_PATIENT)
  const [clinical, setClinical] = useState<ClinicalInfo>(EMPTY_CLINICAL)
  const [neuro, setNeuro] = useState<NeuroExam>(EMPTY_NEURO)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const P = <K extends keyof Patient>(k: K, v: Patient[K]) => setPatient((p) => ({ ...p, [k]: v }))
  const C = <K extends keyof ClinicalInfo>(k: K, v: ClinicalInfo[K]) => setClinical((c) => ({ ...c, [k]: v }))
  const N = <K extends keyof NeuroExam>(k: K, v: NeuroExam[K]) => setNeuro((n) => ({ ...n, [k]: v }))

  const hint = localize(neuro, clinical)

  const fillSample = () => {
    setPatient(SAMPLE_FORM.patient)
    setClinical(SAMPLE_FORM.clinical)
    setNeuro(SAMPLE_FORM.neuro)
    setFiles(SAMPLE_FORM.files.map((f, i) => ({ ...f, id: `s${i}` })))
    pushToast({ tone: 'info', title: 'Form örnek vaka ile dolduruldu', body: 'Fındık — Beagle, akut pelvik parezi' })
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const added = Array.from(list).map((f) => ({
      id: `${f.name}-${f.lastModified}-${Math.random()}`,
      name: f.name,
      type: guessType(f.name),
      size: f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`,
    }))
    setFiles((fs) => [...fs, ...added])
  }

  const canNext = step !== 0 || (patient.name.trim() && patient.breed.trim() && patient.ownerName.trim())

  const submit = () => {
    const id = `c-new-${Date.now()}`
    const no = `VM-2026-0${150 + cases.filter((c) => c.id.startsWith('c-new')).length}`
    const stamp = nowStamp()
    const loc = localize(neuro, clinical)
    const built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp)
    const priority: Priority = neuro.gait === 'Pleji' || neuro.deepPain === 'Yok' ? 'Acil' : neuro.gait === 'Parezi' || neuro.consciousness !== 'Uyanık' ? 'Yüksek' : 'Normal'
    const newCase: VetCase = {
      id,
      no,
      patient,
      clinical,
      neuro,
      documents: files.map((f, i) => ({ ...makeDocument(`${id}-d${i}`, f.name, f.type, patient, clinical, built.imaging), size: f.size })),
      status: 'isleniyor',
      module: 'Nöroloji',
      priority,
      createdAt: today(),
      clinic: CLINIC,
      vetName: 'Dr. Elif Kaya',
      ai: built.ai,
      aiDraft: built.draft,
      report: { ...built.draft },
      corrections: [],
      timeline: [
        { date: stamp, label: 'Vaka oluşturuldu', by: 'Dr. Elif Kaya' },
        { date: stamp, label: `${files.length} tetkik belgesi yüklendi`, by: 'Dr. Elif Kaya' },
      ],
      processingStartedAt: Date.now(),
    }
    addCase(newCase)
    // İşlem hattı simülasyonu: sayfadan ayrılınsa bile durum güncellemeleri tamamlanır.
    setTimeout(() => updateCase(id, { status: 'ai_analizi' }), AI_PHASE_START)
    setTimeout(() => {
      const done = nowStamp()
      updateCase(id, (c) => ({
        status: 'uzman_incelemesinde',
        processingMs: PIPELINE_MS,
        timeline: [
          ...c.timeline,
          { date: done, label: 'Belgeler işlendi', by: 'Sistem' },
          { date: done, label: 'AI ön değerlendirmesi oluşturuldu, uzman kuyruğuna iletildi', by: 'vetmind-neuro-v0.1' },
        ],
      }))
      pushToast({ tone: 'success', title: 'AI ön değerlendirmesi hazır', body: `${patient.name} vakası uzman kuyruğuna iletildi.` })
    }, PIPELINE_MS)
    nav(`/vakalar/${id}/isleme`)
  }

  return (
    <>
      <PageHeader
        title="Yeni Vaka"
        subtitle="Nöroloji modülü · Kedi ve köpek"
        breadcrumb="Vakalar / Yeni Vaka"
        actions={<Button variant="secondary" icon={<Sparkles className="h-4 w-4 text-teal-600" />} onClick={fillSample}>Örnek vaka ile doldur</Button>}
      />
      <Card className="mb-6 p-5">
        <StepIndicator steps={STEPS} current={step} onSelect={setStep} />
      </Card>

      <Card className="p-6">
        {step === 0 && (
          <div className="animate-fade-up">
            <h2 className="mb-5 text-lg font-semibold text-navy-900">Hasta Bilgileri</h2>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Hasta adı *"><input className="input" value={patient.name} onChange={(e) => P('name', e.target.value)} placeholder="ör. Paşa" /></Field>
              <Field label="Tür"><Pills options={['Köpek', 'Kedi'] as const} value={patient.species} onChange={(v) => P('species', v)} /></Field>
              <Field label="Irk *"><input className="input" value={patient.breed} onChange={(e) => P('breed', e.target.value)} placeholder="ör. Dachshund" /></Field>
              <Field label="Cinsiyet"><Pills options={['Erkek', 'Dişi'] as const} value={patient.sex} onChange={(v) => P('sex', v)} /></Field>
              <Field label="Kısırlaştırma durumu"><Pills options={['Kısırlaştırılmış', 'Kısırlaştırılmamış'] as const} value={patient.neutered ? 'Kısırlaştırılmış' : 'Kısırlaştırılmamış'} onChange={(v) => P('neutered', v === 'Kısırlaştırılmış')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Yaş (yıl)"><input type="number" min={0} className="input" value={patient.age || ''} onChange={(e) => P('age', Number(e.target.value))} /></Field>
                <Field label="Kilo (kg)"><input type="number" min={0} step="0.1" className="input" value={patient.weight || ''} onChange={(e) => P('weight', Number(e.target.value))} /></Field>
              </div>
              <Field label="Sahip adı soyadı *"><input className="input" value={patient.ownerName} onChange={(e) => P('ownerName', e.target.value)} placeholder="ör. Mehmet Yılmaz" /></Field>
              <Field label="Sahip telefon"><input className="input" value={patient.ownerPhone} onChange={(e) => P('ownerPhone', e.target.value)} placeholder="05xx xxx xx xx" /></Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-fade-up">
            <h2 className="mb-5 text-lg font-semibold text-navy-900">Klinik Bilgiler</h2>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Başvuru şikâyeti" className="md:col-span-2"><textarea rows={3} className="input" value={clinical.complaint} onChange={(e) => C('complaint', e.target.value)} placeholder="Sahibin bildirdiği ana şikâyet" /></Field>
              <Field label="Belirtilerin başlangıcı"><Pills options={['Akut', 'Kronik'] as const} value={clinical.onset} onChange={(v) => C('onset', v)} /></Field>
              <Field label="Seyir"><Pills options={['Progresif', 'Stabil', 'İyileşen'] as const} value={clinical.course} onChange={(v) => C('course', v)} /></Field>
              <Field label="Klinik geçmiş"><textarea rows={3} className="input" value={clinical.history} onChange={(e) => C('history', e.target.value)} /></Field>
              <Field label="Mevcut ilaçlar"><textarea rows={3} className="input" value={clinical.medications} onChange={(e) => C('medications', e.target.value)} /></Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid animate-fade-up gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <h2 className="text-lg font-semibold text-navy-900">Nörolojik Muayene Formu</h2>
              <Field label="Bilinç durumu"><Pills options={['Uyanık', 'Depresif', 'Stupor', 'Koma'] as const} value={neuro.consciousness} onChange={(v) => N('consciousness', v)} /></Field>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Yürüyüş"><Pills options={['Normal', 'Ataksi', 'Parezi', 'Pleji'] as const} value={neuro.gait} onChange={(v) => N('gait', v)} /></Field>
                <Field label="Etkilenen bacaklar"><Checks options={LIMBS} value={neuro.limbs} onChange={(v) => N('limbs', v)} /></Field>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Postüral reaksiyonlar — ön bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok'] as const} value={neuro.posturalThoracic} onChange={(v) => N('posturalThoracic', v)} /></Field>
                <Field label="Postüral reaksiyonlar — arka bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok'] as const} value={neuro.posturalPelvic} onChange={(v) => N('posturalPelvic', v)} /></Field>
                <Field label="Spinal refleksler — torasik"><Pills options={['Normal', 'Azalmış', 'Artmış'] as const} value={neuro.reflexThoracic} onChange={(v) => N('reflexThoracic', v)} /></Field>
                <Field label="Spinal refleksler — pelvik"><Pills options={['Normal', 'Azalmış', 'Artmış'] as const} value={neuro.reflexPelvic} onChange={(v) => N('reflexPelvic', v)} /></Field>
              </div>
              <Field label="Kraniyal sinir bulguları (yoksa boş bırakın)"><Checks options={CN} value={neuro.cranialNerves} onChange={(v) => N('cranialNerves', v)} /></Field>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Ağrı algısı (derin ağrı)"><Pills options={['Var', 'Yok', 'Değerlendirilmedi'] as const} value={neuro.deepPain} onChange={(v) => N('deepPain', v)} /></Field>
                <Field label="Spinal hiperestezi bölgesi"><Pills options={['Yok', 'Servikal', 'Torakolomber', 'Lumbosakral'] as const} value={neuro.hyperesthesia} onChange={(v) => N('hyperesthesia', v)} /></Field>
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
                <p className="mt-4 border-t border-teal-100 pt-3 text-[11px] text-slate-500">Kural tabanlı ipucudur; tanı yerine geçmez.</p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-up">
            <h2 className="mb-1 text-lg font-semibold text-navy-900">Tetkik Yükleme</h2>
            <p className="mb-5 text-sm text-slate-500">MR raporu, BT raporu, laboratuvar sonucu ve önceki raporlar (PDF). Bu demoda dosyalar işlenmez.</p>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                addFiles(e.dataTransfer.files)
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/40'
              }`}
            >
              <UploadCloud className="h-10 w-10 text-teal-600" />
              <p className="mt-3 font-medium text-navy-900">Dosyaları buraya sürükleyin veya seçmek için tıklayın</p>
              <p className="mt-1 text-xs text-slate-500">PDF, JPG, PNG · en fazla 25 MB</p>
              <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
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
          </div>
        )}

        {step === 4 && (
          <div className="animate-fade-up space-y-5">
            <h2 className="text-lg font-semibold text-navy-900">Özet ve Gönder</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Summary title="Hasta Bilgileri" onEdit={() => setStep(0)} rows={[
                ['Hasta', `${patient.name || '—'} (${patient.species})`],
                ['Irk', patient.breed || '—'],
                ['Cinsiyet', `${patient.sex}, ${patient.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}`],
                ['Yaş / Kilo', `${patient.age} yaş · ${patient.weight} kg`],
                ['Sahip', `${patient.ownerName || '—'} ${patient.ownerPhone ? `· ${patient.ownerPhone}` : ''}`],
              ]} />
              <Summary title="Klinik Bilgiler" onEdit={() => setStep(1)} rows={[
                ['Şikâyet', clinical.complaint || '—'],
                ['Başlangıç / Seyir', `${clinical.onset} · ${clinical.course}`],
                ['Klinik geçmiş', clinical.history || '—'],
                ['İlaçlar', clinical.medications || '—'],
              ]} />
              <Summary title="Nörolojik Muayene" onEdit={() => setStep(2)} rows={[
                ['Bilinç', neuro.consciousness],
                ['Yürüyüş', `${neuro.gait}${neuro.limbs.length ? ` (${neuro.limbs.join(', ')})` : ''}`],
                ['Postüral (ön / arka)', `${neuro.posturalThoracic} / ${neuro.posturalPelvic}`],
                ['Refleksler (torasik / pelvik)', `${neuro.reflexThoracic} / ${neuro.reflexPelvic}`],
                ['Kraniyal sinirler', neuro.cranialNerves.join(', ') || 'Normal'],
                ['Derin ağrı', neuro.deepPain],
                ['Hiperestezi', neuro.hyperesthesia],
                ['Olası lokalizasyon', hint?.region ?? '—'],
              ]} />
              <Summary title={`Tetkikler (${files.length})`} onEdit={() => setStep(3)} rows={files.length ? files.map((f) => [f.type, f.name]) : [['—', 'Belge yüklenmedi']]} />
            </div>
            <div className="flex flex-col items-start gap-4 rounded-xl border border-navy-100 bg-navy-50/60 p-5 md:flex-row md:items-center">
              <Brain className="h-8 w-8 shrink-0 text-teal-600" />
              <p className="flex-1 text-sm text-navy-800">
                Gönderdiğinizde belgeler işlenecek, nöroloji bilgi tabanından ilgili kaynaklar getirilecek ve yapay zekâ ön değerlendirmesi oluşturularak <strong>uzman veteriner hekim onayına</strong> iletilecektir.
              </p>
              <Button size="lg" onClick={submit} disabled={!patient.name.trim()} icon={<Sparkles className="h-4 w-4" />}>Yapay Zekâ Değerlendirmesine Gönder</Button>
            </div>
          </div>
        )}

        {step < 4 && (
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>Geri</Button>
            <div className="flex items-center gap-3">
              {!canNext && <span className="text-xs text-slate-500">Zorunlu alanları doldurun</span>}
              <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                İleri <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="mt-6">
            <Button variant="ghost" onClick={() => setStep(3)} icon={<ArrowLeft className="h-4 w-4" />}>Geri</Button>
          </div>
        )}
      </Card>
    </>
  )
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><Pencil className="h-3 w-3" /> Düzenle</button>
      </div>
      <dl className="divide-y divide-slate-50 px-4 py-1">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-5 gap-3 py-2 text-sm">
            <dt className="col-span-2 text-slate-500">{k}</dt>
            <dd className="col-span-3 text-navy-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
