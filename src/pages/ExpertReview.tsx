import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, FileSearch, GraduationCap, History, PenLine, RotateCcw, Send, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { AIDisclaimer } from '../components/AIDisclaimer'
import { Citations } from '../components/CitationChip'
import { EmptyState } from '../components/EmptyState'
import { SECTION_LABELS, USERS } from '../data/mock'
import { nowStamp, today } from '../lib/format'
import { submitBackendReview } from '../lib/backend'
import type { CorrectionCategory, ReportSections, SectionKey } from '../types'

const KEYS = Object.keys(SECTION_LABELS) as SectionKey[]
const CATEGORIES: CorrectionCategory[] = ['Klinik hata', 'Eksik bilgi', 'Üslup', 'Kaynak hatası']

export default function ExpertReview() {
  const { id = '' } = useParams()
  const { getCase, updateCase, pushToast } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const [text, setText] = useState<ReportSections | undefined>(c?.report)
  const [cats, setCats] = useState<Partial<Record<SectionKey, CorrectionCategory>>>({})
  const [modal, setModal] = useState<null | 'revizyon' | 'reddedildi'>(null)
  const [reason, setReason] = useState('')

  if (!c) {
    return <Card><EmptyState icon={<FileSearch className="h-6 w-6" />} title="Vaka bulunamadı" action={<Link to="/kuyruk" className="text-sm font-medium text-teal-700">Onay kuyruğuna dön</Link>} /></Card>
  }
  if (c.status === 'analiz_basarisiz' || c.backendOutcome === 'failed') {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="AI analizi başarısız — onaylanabilir taslak yok"
          text="Bu durum uzman revizyon talebi değildir. Mock/FastAPI adapter hatası nedeniyle AI draft üretilmedi."
          action={<Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">Vaka detayına dön</Link>}
        />
      </Card>
    )
  }
  if (c.status === 'manuel_inceleme' || c.backendOutcome === 'unsupported') {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Manuel inceleme — AI draft onayı kapalı"
          text="Desteklenmeyen vaka. Bu ekran AI taslağı onaylamak için değildir; orijinal çalışma manuel radyolog incelemesi gerektirir."
          action={<Link to={`/vakalar/${c.id}?tab=ai`} className="text-sm font-medium text-teal-700">Bulgulara / vaka detayına git</Link>}
        />
      </Card>
    )
  }
  if (!c.aiDraft || !text) {
    return <Card><EmptyState icon={<FileSearch className="h-6 w-6" />} title="İncelenecek taslak bulunamadı" action={<Link to="/kuyruk" className="text-sm font-medium text-teal-700">Onay kuyruğuna dön</Link>} /></Card>
  }
  const draft = c.aiDraft
  const draftEligible =
    !c.backendCaseId
    || (c.backendOutcome === 'success' || c.backendOutcome === 'partial')
      && c.backendDraft?.status !== 'validation_failed'
  const reviewable = c.status === 'uzman_incelemesinde' && draftEligible
  const edited = KEYS.filter((k) => text[k].trim() !== draft[k].trim())
  const corrections = edited.map((k) => ({ section: k, before: draft[k], after: text[k], category: cats[k] ?? 'Eksik bilgi' }))
  const warnings = c.ai?.validation.filter((v) => v.kind !== 'ok') ?? []

  const syncBackendReview = async (action: 'approve' | 'reject' | 'request_revision', comment?: string) => {
    if (!c.backendCaseId) return true
    try {
      await submitBackendReview(c.backendCaseId, {
        action,
        comment,
        edited_technique: text.klinikOzet,
        edited_findings: text.bulgular,
        edited_impression: text.degerlendirme,
        edited_recommendations: text.oneriler,
      })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review reddedildi'
      pushToast({ tone: 'error', title: 'Backend review reddedildi', body: msg })
      return false
    }
  }

  const approve = async () => {
    if (!reviewable) {
      pushToast({ tone: 'error', title: 'Onaylanamaz', body: 'Bu vaka için AI draft onayı uygun değil.' })
      return
    }
    const ok = await syncBackendReview('approve')
    if (!ok) return
    const stamp = nowStamp()
    updateCase(c.id, (x) => ({
      status: 'onaylandi',
      report: text,
      corrections,
      approvedBy: USERS.expert.name,
      approvedAt: today(),
      reportNo: x.no.replace('VM-', 'VMR-'),
      statusNote: undefined,
      timeline: [...x.timeline, { date: stamp, label: `Uzman tarafından AI taslağı onaylandı ve yayınlandı${corrections.length ? ` (${corrections.length} düzeltme)` : ''}`, by: USERS.expert.name }],
    }))
    pushToast({ tone: 'success', title: 'Rapor onaylandı ve yayınlandı', body: `${c.patient.name} — veteriner hekim ve hayvan sahibi bilgilendirildi.` })
    nav(`/raporlar/${c.id}`)
  }

  const decide = async () => {
    if (!modal) return
    const ok = await syncBackendReview(modal === 'revizyon' ? 'request_revision' : 'reject', reason.trim() || undefined)
    if (!ok) return
    const stamp = nowStamp()
    updateCase(c.id, (x) => ({
      status: modal,
      report: text,
      corrections,
      statusNote: reason.trim(),
      timeline: [...x.timeline, { date: stamp, label: modal === 'revizyon' ? 'Revizyon istendi' : 'Rapor reddedildi', by: USERS.expert.name }],
    }))
    pushToast({ tone: modal === 'revizyon' ? 'warning' : 'error', title: modal === 'revizyon' ? 'Revizyon istendi' : 'Rapor reddedildi', body: `${c.patient.name} — gerekçe kaydedildi.` })
    setModal(null)
    setReason('')
    nav('/kuyruk')
  }

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/kuyruk" className="hover:underline">Onay Kuyruğu</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Uzman İnceleme — {c.patient.name} <StatusBadge status={c.status} /> <PriorityBadge priority={c.priority} />
          </span>
        }
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed}, ${c.patient.age} yaş · ${c.clinic}`}
        actions={<Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => nav(`/vakalar/${c.id}?tab=ai`)}>Tam AI değerlendirmesi</Button>}
      />

      {!reviewable && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Bu vaka şu anda inceleme kuyruğunda değil; editör salt okunurdur.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-5">
          <AIDisclaimer />
          {warnings.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader title="Doğrulama katmanı uyarıları" icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} />
              <ul className="space-y-2 p-4">
                {warnings.map((w, i) => (
                  <li key={i} className={`rounded-lg p-3 text-sm ${w.kind === 'missing' ? 'bg-amber-50 text-amber-900' : 'bg-rose-50 text-rose-900'}`}>
                    <span className="font-semibold">{w.kind === 'missing' ? 'Eksik bilgi: ' : 'Kaynaksız ifade: '}</span>
                    {w.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="AI taslağı" subtitle={`${c.ai?.model} tarafından oluşturuldu`} icon={<Bot className="h-5 w-5" />} />
            <div className="divide-y divide-slate-100">
              {KEYS.map((k) => (
                <div key={k} className="px-5 py-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{SECTION_LABELS[k]}</p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-navy-800">{draft[k]}</p>
                  {k === 'ayiriciTanilar' && c.ai && (
                    <p className="mt-2 text-xs text-slate-500">Kaynaklar: <Citations ids={Array.from(new Set(c.ai.differentials.flatMap((d) => d.citations)))} /></p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="xl:sticky xl:top-20">
            <CardHeader title="Rapor editörü" subtitle="Düzenlemeleriniz düzeltme kaydına otomatik eklenir" icon={<PenLine className="h-5 w-5" />} />
            <div className="max-h-none divide-y divide-slate-100 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto">
              {KEYS.map((k) => {
                const isEdited = edited.includes(k)
                return (
                  <div key={k} className="px-5 py-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold text-navy-900">{SECTION_LABELS[k]}</label>
                      <div className="flex items-center gap-2">
                        {isEdited && (
                          <>
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Düzenlendi</span>
                            <button disabled={!reviewable} onClick={() => setText({ ...text, [k]: draft[k] })} title="AI metnine geri al" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <textarea
                      disabled={!reviewable}
                      rows={k === 'klinikOzet' || k === 'ayiriciTanilar' ? 4 : 5}
                      value={text[k]}
                      onChange={(e) => setText({ ...text, [k]: e.target.value })}
                      className={`input leading-relaxed ${isEdited ? 'border-violet-300 bg-violet-50/30' : ''}`}
                    />
                    {isEdited && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-slate-500">Düzeltme kategorisi:</span>
                        <select disabled={!reviewable} value={cats[k] ?? 'Eksik bilgi'} onChange={(e) => setCats({ ...cats, [k]: e.target.value as CorrectionCategory })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                          {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {reviewable && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setModal('reddedildi')}>Reddet</Button>
                <Button variant="warning" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setModal('revizyon')}>Revizyon İste</Button>
                <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={approve}>Onayla ve Yayınla</Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title={`Düzeltme Kaydı (${corrections.length})`} subtitle="AI metni → uzman metni" icon={<History className="h-5 w-5" />} />
        <div className="flex items-start gap-2 border-b border-slate-100 bg-navy-50/50 px-5 py-3 text-xs text-navy-700">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
          Bu düzeltmeler, ileride modelin iyileştirilmesi (ince ayar / değerlendirme seti) için anonimleştirilerek toplanan uzman geri bildirimidir.
        </div>
        {corrections.length ? (
          <ul className="divide-y divide-slate-100">
            {corrections.map((cr) => (
              <li key={cr.section} className="grid gap-3 px-5 py-4 lg:grid-cols-12">
                <div className="lg:col-span-2">
                  <p className="text-sm font-semibold text-navy-900">{SECTION_LABELS[cr.section]}</p>
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{cr.category}</span>
                </div>
                <p className="whitespace-pre-line rounded-lg bg-rose-50 p-3 text-sm text-rose-900 line-through decoration-rose-300 lg:col-span-5">{cr.before}</p>
                <p className="whitespace-pre-line rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 lg:col-span-5">{cr.after}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
            <Send className="h-4 w-4" /> Henüz düzeltme yok. Editörde bir bölümü değiştirdiğinizde burada görünecek.
          </p>
        )}
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'revizyon' ? 'Revizyon iste' : 'Raporu reddet'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Vazgeç</Button>
            <Button variant={modal === 'revizyon' ? 'warning' : 'danger'} disabled={reason.trim().length < 10} onClick={decide}>
              {modal === 'revizyon' ? 'Revizyon iste' : 'Reddet'}
            </Button>
          </>
        }
      >
        <label className="label">Gerekçe (zorunlu)</label>
        <textarea rows={4} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={modal === 'revizyon' ? 'ör. Derin ağrı algısı değerlendirilip forma eklenmeli.' : 'ör. Yüklenen MR raporu farklı bir hastaya ait.'} />
        <p className="mt-2 text-xs text-slate-500">En az 10 karakter. Gerekçe veteriner hekime iletilir ve düzeltme kaydına eklenir.</p>
      </Modal>
    </>
  )
}
