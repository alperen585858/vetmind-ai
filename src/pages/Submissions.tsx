import { useEffect, useRef, useState, type DragEvent, type InputHTMLAttributes } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { demoEmailForRole } from '../lib/auth'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { StepIndicator } from '../components/StepIndicator'
import { DEMO_PRICE_LABEL, DemoPaymentStep } from '../components/DemoPaymentStep'
import {
  attachSubmission,
  closeSubmissionInfoRequest,
  createDemoPaymentIntent,
  createSubmission,
  deleteSubmission,
  fetchIngestDicomFiles,
  getDemoPayment,
  getDemoPaymentBySubmission,
  getDicomIngestion,
  listPets,
  listSubmissions,
  replySubmissionInfoRequest,
  updateSubmission,
  uploadDicomDemo,
  uploadDicomFiles,
  uploadDocuments,
  vetSubmissionAction,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import type {
  BackendDemoPayment,
  BackendImagingSubmission,
  BackendPet,
  DicomIngestionRecord,
  Species,
} from '../types'

const STATUS_TR: Record<string, string> = {
  draft: 'Taslak',
  pending_verification: 'Vet onayı bekliyor',
  needs_info: 'Eksik bilgi istendi',
  verified: 'Doğrulandı',
  rejected: 'Reddedildi',
  linked: 'Vakaya bağlandı',
}

const WIZARD_STEPS = ['Hayvan ve klinik', 'DICOM seç', 'Talep özeti', 'Ödeme']

const DRAFT_STORAGE_KEY = 'vetmind.submissionDraft'

function petSpeciesLabel(species?: string | null): Species {
  return species === 'feline' ? 'Kedi' : 'Köpek'
}

function collectFiles(list: FileList | null): File[] {
  if (!list?.length) return []
  return Array.from(list).filter((f) => f.size > 0)
}

export default function Submissions() {
  const { role, pushToast } = useApp()
  const navigate = useNavigate()
  const { submissionId: routeSubmissionId } = useParams<{ submissionId?: string }>()
  const isOwner = role === 'owner'
  const isVet = role === 'vet' || role === 'clinic_owner'
  const [rows, setRows] = useState<BackendImagingSubmission[]>([])
  const [pets, setPets] = useState<BackendPet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [petId, setPetId] = useState('')
  const [complaint, setComplaint] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [useDemoDicom, setUseDemoDicom] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [draftSub, setDraftSub] = useState<BackendImagingSubmission | null>(null)
  const [payment, setPayment] = useState<BackendDemoPayment | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [submitLock, setSubmitLock] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null)
  const [docAttachTargetId, setDocAttachTargetId] = useState<string | null>(null)
  const docAttachInputRef = useRef<HTMLInputElement>(null)
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [infoRequestText, setInfoRequestText] = useState<Record<string, string>>({})
  const [detailIngestId, setDetailIngestId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DicomIngestionRecord | null>(null)
  const [detailFrames, setDetailFrames] = useState<DicomFramePreview[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    void Promise.all([listSubmissions(), isOwner ? listPets() : Promise.resolve([])])
      .then(([subs, p]) => {
        setRows(subs)
        setPets(p)
        if (p[0] && !petId) setPetId(p[0].pet_id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  useEffect(() => {
    if (!routeSubmissionId) return
    const el = document.getElementById(`submission-${routeSubmissionId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [routeSubmissionId, rows])

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return
    setFiles((prev) => {
      const names = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const next = [...prev]
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`
        if (!names.has(key)) {
          names.add(key)
          next.push(f)
        }
      }
      return next
    })
  }

  const uploadAndLink = async (
    sub: BackendImagingSubmission,
    opts: { files?: File[]; demo?: boolean },
  ) => {
    const pet = pets.find((p) => p.pet_id === sub.pet_id)
    const patientName = pet?.name || 'Pet'
    const species = petSpeciesLabel(pet?.species)
    const breed = pet?.breed || undefined
    const clinicalHistory = sub.chief_complaint || sub.clinical_notes || complaint || notes || 'Owner imaging request'

    const dicom =
      opts.files && opts.files.length > 0
        ? await uploadDicomFiles({
            files: opts.files,
            patientName,
            species,
            breed,
            clinicalHistory,
          })
        : await uploadDicomDemo({
            kind: 'brain_mri',
            patientName,
            species,
            breed,
            clinicalHistory,
          })

    if (!dicom.ingest_id) {
      throw new Error('DICOM yüklemesi ingest_id döndürmedi.')
    }
    if (dicom.blocked) {
      throw new Error(dicom.block_reason || 'DICOM karantinada engellendi.')
    }
    return attachSubmission(sub.submission_id, { kind: 'dicom', ingest_id: dicom.ingest_id })
  }

  const uploadDocAndLink = async (sub: BackendImagingSubmission, files: File[]) => {
    const pet = pets.find((p) => p.pet_id === sub.pet_id)
    const patientName = pet?.name || 'Pet'
    const species = petSpeciesLabel(pet?.species)
    const doc = await uploadDocuments({
      files,
      patientName,
      species,
      breed: pet?.breed || undefined,
      clinicalHistory: sub.chief_complaint || sub.clinical_notes || 'Owner document',
    })
    if (!doc.ingest_id) throw new Error('Belge yüklemesi ingest_id döndürmedi.')
    if (doc.blocked) throw new Error(doc.block_reason || 'Belge engellendi.')
    return attachSubmission(sub.submission_id, { kind: 'document', ingest_id: doc.ingest_id })
  }

  const resetWizard = () => {
    setWizardStep(0)
    setComplaint('')
    setNotes('')
    setFiles([])
    setUseDemoDicom(false)
    setDraftSub(null)
    setPayment(null)
    setPaymentReady(false)
    setSubmitLock(false)
    setPaymentSuccess(false)
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  /** Persist draft ids so refresh keeps an approved/in-progress demo payment. */
  const persistDraftIds = (submissionId: string, paymentId?: string | null) => {
    try {
      sessionStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ submissionId, paymentId: paymentId || null, petId, complaint, notes }),
      )
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!isOwner || pets.length === 0) return
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as {
        submissionId?: string
        paymentId?: string | null
        petId?: string
        complaint?: string
        notes?: string
      }
      if (!saved.submissionId) return
      if (saved.petId) setPetId(saved.petId)
      if (saved.complaint) setComplaint(saved.complaint)
      if (saved.notes) setNotes(saved.notes)
      void (async () => {
        try {
          const pay = saved.paymentId
            ? await getDemoPayment(saved.paymentId)
            : await getDemoPaymentBySubmission(saved.submissionId!)
          setPayment(pay)
          setDraftSub({
            submission_id: saved.submissionId!,
            pet_id: saved.petId || petId,
            pet_owner_subject: '',
            status: pay.status === 'approved' ? 'pending_verification' : 'draft',
            created_at: '',
            updated_at: '',
            payment_id: pay.payment_id,
            payment_status: pay.status,
          })
          setWizardStep(3)
          setPaymentReady(true)
          if (pay.status === 'approved') {
            pushToast({
              tone: 'success',
              title: 'Demo Payment Approved',
              body: 'Önceki onaylı demo ödeme korundu.',
            })
            navigate(`/basvurular/${saved.submissionId}`, { replace: true })
            resetWizard()
            load()
          }
        } catch {
          /* stale draft — ignore */
        }
      })()
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, pets.length])

  const preparePaymentStep = async () => {
    if (!petId || submitLock) return
    if (!useDemoDicom && files.length === 0) {
      pushToast({
        tone: 'error',
        title: 'DICOM seçilmedi',
        body: 'Kendi .dcm dosyalarınızı ekleyin veya demo DICOM kullanın.',
      })
      return
    }
    setBusy('prepare-pay')
    setSubmitLock(true)
    try {
      let sub = draftSub
      if (!sub || sub.status !== 'draft') {
        sub = await createSubmission({
          pet_id: petId,
          chief_complaint: complaint || undefined,
          clinical_notes: notes || undefined,
        })
        if (!sub.dicom_ingest_id) {
          sub = await uploadAndLink(sub, useDemoDicom ? { demo: true } : { files })
        }
        setDraftSub(sub)
      }
      const intent = await createDemoPaymentIntent(sub.submission_id)
      setPayment(intent)
      persistDraftIds(sub.submission_id, intent.payment_id)
      setPaymentReady(true)
      setWizardStep(3)
    } catch (e) {
      setSubmitLock(false)
      pushToast({
        tone: 'error',
        title: 'Ödeme adımı hazırlanamadı',
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  const openAttachPicker = (id: string) => {
    setAttachTargetId(id)
    attachInputRef.current?.click()
  }

  const onAttachFiles = async (list: FileList | null) => {
    const id = attachTargetId
    setAttachTargetId(null)
    const picked = collectFiles(list)
    if (!id || !picked.length) return
    const row = rows.find((r) => r.submission_id === id)
    if (!row) return
    setBusy(id)
    try {
      const linked = await uploadAndLink(row, { files: picked })
      pushToast({
        tone: 'success',
        title: 'DICOM eklendi',
        body: `Ingest ${linked.dicom_ingest_id} · ${picked.length} dosya · veteriner doğrulaması gerekir.`,
      })
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'DICOM eklenemedi', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const attachDemo = async (id: string) => {
    const row = rows.find((r) => r.submission_id === id)
    if (!row) return
    setBusy(id)
    try {
      const linked = await uploadAndLink(row, { demo: true })
      pushToast({
        tone: 'success',
        title: 'Demo DICOM eklendi',
        body: `Ingest ${linked.dicom_ingest_id} · veteriner doğrulaması gerekir.`,
      })
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'DICOM eklenemedi', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const openDocAttachPicker = (id: string) => {
    setDocAttachTargetId(id)
    docAttachInputRef.current?.click()
  }

  const onAttachDocs = async (list: FileList | null) => {
    const id = docAttachTargetId
    setDocAttachTargetId(null)
    const picked = collectFiles(list)
    if (!id || !picked.length) return
    const row = rows.find((r) => r.submission_id === id)
    if (!row) return
    setBusy(id)
    try {
      const linked = await uploadDocAndLink(row, picked)
      pushToast({
        tone: 'success',
        title: 'Belge eklendi',
        body: `Ingest ${linked.document_ingest_id || linked.attachments?.slice(-1)[0]?.ingest_id}`,
      })
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Belge eklenemedi', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const sendOwnerReply = async (s: BackendImagingSubmission) => {
    const openReq = (s.info_requests || []).find((r) => r.status === 'OPEN')
    const text = (replyDraft[s.submission_id] || '').trim()
    if (!text) {
      pushToast({ tone: 'error', title: 'Yanıt boş', body: 'Lütfen istenen bilgiyi yazın.' })
      return
    }
    setBusy(s.submission_id)
    try {
      if (openReq) {
        await replySubmissionInfoRequest(s.submission_id, openReq.request_id, text)
      } else {
        await updateSubmission(s.submission_id, { clinical_notes: text })
      }
      pushToast({ tone: 'success', title: 'Yanıt gönderildi', body: 'Veteriner tekrar inceleyecek.' })
      setReplyDraft((prev) => ({ ...prev, [s.submission_id]: '' }))
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Yanıt gönderilemedi', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const closeReq = async (submissionId: string, requestId: string) => {
    setBusy(submissionId)
    try {
      await closeSubmissionInfoRequest(submissionId, requestId)
      pushToast({ tone: 'info', title: 'Bilgi isteği kapatıldı' })
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Kapatılamadı', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const canOwnerAttach = (s: BackendImagingSubmission) =>
    isOwner && (s.status === 'pending_verification' || s.status === 'needs_info' || s.status === 'draft')

  const canDelete = (s: BackendImagingSubmission) =>
    (isOwner || isVet) && s.status !== 'linked' && !s.linked_case_id

  const removeSubmission = async (s: BackendImagingSubmission) => {
    if (!canDelete(s)) return
    const ok = window.confirm(
      `Bu başvuruyu silmek istediğinize emin misiniz?\n\n${s.submission_id}\n${s.chief_complaint || s.clinical_notes || 'Başvuru'}`,
    )
    if (!ok) return
    setBusy(`del-${s.submission_id}`)
    try {
      await deleteSubmission(s.submission_id)
      pushToast({ tone: 'success', title: 'Başvuru silindi', body: s.submission_id })
      if (routeSubmissionId === s.submission_id) navigate('/basvurular', { replace: true })
      load()
    } catch (e) {
      pushToast({
        tone: 'error',
        title: 'Silinemedi',
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    addFiles(collectFiles(e.dataTransfer.files))
  }

  const closeDicomDetail = () => {
    setDetailIngestId(null)
    setDetail(null)
    setDetailFrames([])
    setDetailError(null)
    setDetailLoading(false)
  }

  const openDicomDetail = async (ingestId: string) => {
    if (detailIngestId === ingestId) {
      closeDicomDetail()
      return
    }
    setDetailIngestId(ingestId)
    setDetail(null)
    setDetailFrames([])
    setDetailError(null)
    setDetailLoading(true)
    try {
      const record = await getDicomIngestion(ingestId)
      setDetail(record)
      const files = await fetchIngestDicomFiles(ingestId, 8)
      if (files.length) {
        const frames = await buildDicomPreviews(files)
        setDetailFrames(frames.filter((f) => f.ok))
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'DICOM detayı yüklenemedi')
    } finally {
      setDetailLoading(false)
    }
  }

  const act = async (id: string, action: 'accept' | 'reject' | 'request_info') => {
    const row = rows.find((r) => r.submission_id === id)
    if (action === 'accept' && !row?.dicom_ingest_id) {
      pushToast({
        tone: 'error',
        title: 'DICOM yok',
        body: 'Bu başvuruya DICOM bağlı değil. Sahip yeniden yüklemeli veya siz DICOM eklemelisiniz.',
      })
      return
    }
    setBusy(id)
    try {
      const result = await vetSubmissionAction(id, {
        action,
        missing_info_request:
          action === 'request_info'
            ? infoRequestText[id]?.trim() || 'Lütfen klinik öyküyü tamamlayın.'
            : undefined,
        assigned_reviewer_id: action === 'accept' ? demoEmailForRole('expert') : undefined,
        run_analyze: action === 'accept',
        vet_notes: action === 'accept' ? 'Klinik doğrulama tamam' : undefined,
      })
      const caseId = result && 'case_id' in result ? result.case_id : undefined
      const hasDicom = result && 'dicom_ingest_id' in result ? Boolean(result.dicom_ingest_id) : false
      pushToast({
        tone: action === 'accept' ? 'success' : 'info',
        title:
          action === 'accept'
            ? hasDicom
              ? 'Doğrulandı · DICOM vakaya bağlandı'
              : 'Doğrulandı · vaka açıldı (DICOM yok)'
            : action === 'reject'
              ? 'Reddedildi'
              : 'Eksik bilgi istendi',
        body: caseId ? `Vaka: ${caseId}` : undefined,
      })
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'İşlem başarısız', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title={isOwner ? 'DICOM yükle' : 'Başvuru onayı'}
        subtitle={
          isOwner
            ? `Hasta bilgileri → DICOM → özet → demo ödeme (${DEMO_PRICE_LABEL}) → radyoloji iş akışı`
            : 'Doğrula · radyoloğa ata · veya eksik bilgi iste'
        }
        crumbs={[{ label: 'Ana sayfa', to: '/' }, { label: isOwner ? 'DICOM yükle' : 'Başvurular' }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      )}

      {isOwner && (
        <Card className="mb-6 p-5">
          <CardHeader
            title="Yeni görüntüleme talebi"
            subtitle={`Demo ödeme (${DEMO_PRICE_LABEL}) sonrası radyoloji iş akışına gönderilir`}
            icon={<UploadCloud className="h-5 w-5" />}
          />
          {pets.length === 0 ? (
            <p className="px-1 text-sm text-slate-600">
              Önce{' '}
              <Link className="font-medium text-teal-700 hover:underline" to="/hayvanlar">
                pet profili
              </Link>{' '}
              oluşturun.
            </p>
          ) : (
            <div className="space-y-5">
              <StepIndicator
                steps={WIZARD_STEPS}
                current={wizardStep}
                onSelect={(i) => {
                  if (i < wizardStep && !submitLock) setWizardStep(i)
                }}
              />

              {wizardStep === 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="label">
                    Pet
                    <select className="input mt-1" value={petId} onChange={(e) => setPetId(e.target.value)}>
                      {pets.map((p) => (
                        <option key={p.pet_id} value={p.pet_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Şikâyet
                    <input className="input mt-1" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
                  </label>
                  <label className="label sm:col-span-2">
                    Klinik notlar
                    <textarea
                      className="input mt-1 min-h-[72px]"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                  <div className="flex justify-end sm:col-span-2">
                    <Button
                      onClick={() => setWizardStep(1)}
                      disabled={!petId}
                      icon={<ArrowRight className="h-4 w-4" />}
                    >
                      Devam · DICOM
                    </Button>
                  </div>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-3">
                  <p className="label mb-1.5">DICOM görüntüleme</p>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDrag(true)
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={onDrop}
                    className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                      drag
                        ? 'border-teal-600 bg-teal-50'
                        : 'border-slate-200 bg-slate-50/80 hover:border-teal-400'
                    }`}
                  >
                    <UploadCloud className={`mx-auto h-8 w-8 ${drag ? 'text-teal-700' : 'text-teal-600'}`} />
                    <p className="mt-2 text-sm font-medium text-navy-900">
                      {drag ? 'Dosyaları bırakın' : 'DICOM dosya veya klasör sürükleyin'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">.dcm / DICOM Part-10 · birden fazla dosya seçilebilir</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        icon={<FileText className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setUseDemoDicom(false)
                          fileInputRef.current?.click()
                        }}
                      >
                        Dosya seç
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        icon={<FolderOpen className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setUseDemoDicom(false)
                          folderInputRef.current?.click()
                        }}
                      >
                        Klasör seç
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setUseDemoDicom(true)
                          setFiles([])
                        }}
                      >
                        Demo DICOM kullan
                      </Button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".dcm,.dicom,application/dicom,*/*"
                      className="hidden"
                      onChange={(e) => {
                        setUseDemoDicom(false)
                        addFiles(collectFiles(e.target.files))
                        e.target.value = ''
                      }}
                    />
                    <input
                      ref={folderInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        setUseDemoDicom(false)
                        addFiles(collectFiles(e.target.files))
                        e.target.value = ''
                      }}
                      {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
                    />
                  </div>

                  {useDemoDicom && (
                    <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                      Demo brain MRI DICOM kullanılacak (gerçek piksel analizi yok).
                    </p>
                  )}

                  {files.length > 0 && (
                    <ul className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-white px-3 py-2">
                      {files.map((f) => (
                        <li
                          key={`${f.name}-${f.size}`}
                          className="flex items-center justify-between gap-2 text-xs text-slate-700"
                        >
                          <span className="truncate">
                            {f.name}{' '}
                            <span className="text-slate-400">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                            onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                            aria-label={`${f.name} kaldır`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap justify-between gap-2">
                    <Button
                      variant="secondary"
                      icon={<ArrowLeft className="h-4 w-4" />}
                      onClick={() => setWizardStep(0)}
                    >
                      Geri
                    </Button>
                    <Button
                      onClick={() => setWizardStep(2)}
                      disabled={!useDemoDicom && files.length === 0}
                      icon={<ArrowRight className="h-4 w-4" />}
                    >
                      Devam · Özet
                    </Button>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
                    <p className="font-semibold text-navy-900">Talep özeti</p>
                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-slate-500">Pet</dt>
                        <dd className="text-navy-900">{pets.find((p) => p.pet_id === petId)?.name || petId}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Ücret</dt>
                        <dd className="font-semibold text-navy-900">{DEMO_PRICE_LABEL} (demo)</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">Şikâyet / notlar</dt>
                        <dd className="text-slate-800">{complaint || notes || '—'}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">DICOM</dt>
                        <dd className="text-slate-800">
                          {useDemoDicom
                            ? 'Demo brain MRI'
                            : `${files.length} dosya (${files
                                .slice(0, 3)
                                .map((f) => f.name)
                                .join(', ')}${files.length > 3 ? '…' : ''})`}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button
                      variant="secondary"
                      icon={<ArrowLeft className="h-4 w-4" />}
                      onClick={() => setWizardStep(1)}
                      disabled={!!busy}
                    >
                      Geri
                    </Button>
                    <Button
                      onClick={() => void preparePaymentStep()}
                      disabled={!!busy || !petId}
                      icon={
                        busy === 'prepare-pay' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRight className="h-4 w-4" />
                        )
                      }
                    >
                      {busy === 'prepare-pay' ? 'Hazırlanıyor…' : 'Ödeme ekranına geç'}
                    </Button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && payment && paymentReady && (
                <div className="space-y-4">
                  <DemoPaymentStep
                    payment={payment}
                    disabled={busy === 'finalize' || paymentSuccess}
                    onSuccessStart={() => setPaymentSuccess(true)}
                    onApproved={(result) => {
                      const sid = result.submission_id || draftSub?.submission_id
                      pushToast({
                        tone: 'success',
                        title: 'Demo Payment Approved',
                        body: 'Talep oluşturuldu ve radyoloji iş akışına gönderildi.',
                      })
                      resetWizard()
                      load()
                      if (sid) navigate(`/basvurular/${sid}`)
                    }}
                  />
                  {!paymentSuccess && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSubmitLock(false)
                        setWizardStep(2)
                      }}
                      disabled={busy === 'finalize'}
                    >
                      Özet’e dön
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <input
        ref={attachInputRef}
        type="file"
        multiple
        accept=".dcm,.dicom,application/dicom,*/*"
        className="hidden"
        onChange={(e) => {
          void onAttachFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={docAttachInputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          void onAttachDocs(e.target.files)
          e.target.value = ''
        }}
      />

      <Card>
        <CardHeader title="Başvuru listesi" icon={<ClipboardCheck className="h-5 w-5" />} />
        {loading ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<ClipboardCheck className="h-5 w-5" />} title="Başvuru yok" text="Henüz kayıt bulunmuyor." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => {
              const answeredReqs = (s.info_requests || []).filter((r) => r.status === 'ANSWERED')
              const requiredActions: string[] = []
              if (isOwner && s.status === 'needs_info') requiredActions.push('Veteriner bilgi istedi — yanıtlayın')
              if (isOwner && canOwnerAttach(s) && !s.dicom_ingest_id) requiredActions.push('DICOM yükleyin')
              if (isVet && s.status === 'pending_verification') requiredActions.push('Doğrula veya ek bilgi iste')
              if (isVet && answeredReqs.length) requiredActions.push('Sahip yanıtını inceleyin')
              const highlighted = routeSubmissionId === s.submission_id
              return (
              <li
                id={`submission-${s.submission_id}`}
                key={s.submission_id}
                className={`px-5 py-4 ${highlighted ? 'bg-teal-50/70 ring-1 ring-inset ring-teal-200' : ''}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-semibold text-navy-900">{STATUS_TR[s.status] ?? s.status}</p>
                    <p className="text-xs text-slate-500">
                      {s.submission_id} · pet {s.pet_id}
                      {s.pet_owner_subject ? ` · sahip ${s.pet_owner_subject}` : ''}
                      {s.dicom_ingest_id ? ' · DICOM ekli' : ' · DICOM yok'}
                      {s.document_ingest_id || (s.attachments || []).some((a) => a.kind === 'document')
                        ? ' · belge ekli'
                        : ''}
                      {(s.attachments || []).length > 1 ? ` · ${s.attachments!.length} ek` : ''}
                      {s.linked_case_id ? (
                        <>
                          {' '}
                          · vaka{' '}
                          <Link className="text-teal-700 hover:underline" to={`/vakalar/${s.linked_case_id}`}>
                            {s.linked_case_id}
                          </Link>
                        </>
                      ) : null}
                      {s.pet_id ? (
                        <>
                          {' '}
                          ·{' '}
                          <Link className="text-teal-700 hover:underline" to="/hayvanlar">
                            geçmiş
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-slate-700">{s.chief_complaint || s.clinical_notes || '—'}</p>
                    {s.missing_info_request && (
                      <p className="mt-1 text-xs text-amber-800">Eksik: {s.missing_info_request}</p>
                    )}
                    {requiredActions.length > 0 && (
                      <ul className="mt-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        {requiredActions.map((a) => (
                          <li key={a}>• {a}</li>
                        ))}
                      </ul>
                    )}
                    {(s.info_requests || []).length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {(s.info_requests || []).map((r) => (
                          <li key={r.request_id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1">
                            <span className="font-medium text-navy-800">{r.status}</span> · {r.body}
                            {r.reply ? <span className="block text-teal-800">Yanıt: {r.reply}</span> : null}
                            {isVet && r.status === 'ANSWERED' && (
                              <button
                                type="button"
                                className="mt-1 text-teal-700 hover:underline"
                                disabled={busy === s.submission_id}
                                onClick={() => void closeReq(s.submission_id, r.request_id)}
                              >
                                Kapat
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.dicom_ingest_id && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Eye className="h-3.5 w-3.5" />}
                        disabled={detailLoading && detailIngestId === s.dicom_ingest_id}
                        onClick={() => void openDicomDetail(s.dicom_ingest_id!)}
                      >
                        {detailIngestId === s.dicom_ingest_id ? 'Detayı kapat' : 'DICOM detay'}
                      </Button>
                    )}
                    {canOwnerAttach(s) && (
                      <>
                        <Button size="sm" disabled={busy === s.submission_id} onClick={() => openAttachPicker(s.submission_id)}>
                          {busy === s.submission_id ? 'Yükleniyor…' : s.dicom_ingest_id ? 'Ek DICOM' : 'DICOM dosya ekle'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === s.submission_id}
                          onClick={() => void attachDemo(s.submission_id)}
                        >
                          Demo DICOM
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<FileText className="h-3.5 w-3.5" />}
                          disabled={busy === s.submission_id}
                          onClick={() => openDocAttachPicker(s.submission_id)}
                        >
                          Belge ekle
                        </Button>
                      </>
                    )}
                    {isVet && (s.status === 'pending_verification' || s.status === 'needs_info') && (
                      <>
                        <Button size="sm" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'accept')}>
                          Doğrula + vaka aç
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'request_info')}>
                          Eksik bilgi
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'reject')}>
                          Reddet
                        </Button>
                      </>
                    )}
                    {canDelete(s) && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        disabled={busy === s.submission_id || busy === `del-${s.submission_id}`}
                        onClick={() => void removeSubmission(s)}
                      >
                        {busy === `del-${s.submission_id}` ? 'Siliniyor…' : 'Sil'}
                      </Button>
                    )}
                  </div>
                </div>
                {isOwner && s.status === 'needs_info' && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <label className="block text-xs font-medium text-amber-950">
                      Veteriner isteğine yanıt
                      <textarea
                        className="input mt-1 min-h-[72px] text-sm"
                        value={replyDraft[s.submission_id] || ''}
                        onChange={(e) => setReplyDraft((prev) => ({ ...prev, [s.submission_id]: e.target.value }))}
                        placeholder="İstenen klinik bilgiyi yazın…"
                      />
                    </label>
                    <Button size="sm" disabled={busy === s.submission_id} onClick={() => void sendOwnerReply(s)}>
                      Yanıtı gönder
                    </Button>
                  </div>
                )}
                {isVet && (s.status === 'pending_verification' || s.status === 'needs_info') && (
                  <label className="mt-3 block text-xs text-slate-600">
                    Eksik bilgi metni (isteğe bağlı)
                    <input
                      className="input mt-1 text-sm"
                      value={infoRequestText[s.submission_id] || ''}
                      onChange={(e) => setInfoRequestText((prev) => ({ ...prev, [s.submission_id]: e.target.value }))}
                      placeholder="Örn. Nöro muayene notu eksik"
                    />
                  </label>
                )}

                {s.dicom_ingest_id && detailIngestId === s.dicom_ingest_id && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                    {detailLoading && (
                      <p className="flex items-center gap-2 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" /> DICOM detayları yükleniyor…
                      </p>
                    )}
                    {detailError && <p className="text-sm text-rose-700">{detailError}</p>}
                    {!detailLoading && detail && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-navy-900">Yüklediğiniz DICOM</p>
                            <p className="text-xs text-slate-500">
                              Ingest {detail.ingest_id}
                              {detail.accepted && detail.case_id ? ` · vakaya bağlandı (${detail.case_id})` : ' · karantinada'}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                            onClick={closeDicomDetail}
                            aria-label="Kapat"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <dl className="grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="text-slate-500">Hasta</dt>
                            <dd className="font-medium text-navy-900">
                              {detail.patient_name} · {detail.species}
                              {detail.breed ? ` · ${detail.breed}` : ''}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Önerilen sınıflandırma</dt>
                            <dd className="font-medium text-navy-900">
                              {detail.classification
                                ? `${detail.classification.suggested_modality} · ${detail.classification.suggested_anatomical_region} (${detail.classification.confidence})`
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Study UID</dt>
                            <dd className="break-all font-mono text-[11px] text-navy-800">
                              {detail.study?.study_instance_uid || '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Seri / instance</dt>
                            <dd className="font-medium text-navy-900">
                              {detail.study
                                ? `${detail.study.series.length} seri · ${detail.study.series.reduce((n, ser) => n + ser.instances.length, 0)} instance`
                                : '—'}
                              {detail.quarantined_files?.length
                                ? ` · ${detail.quarantined_files.length} dosya`
                                : ''}
                            </dd>
                          </div>
                        </dl>
                        {detail.study?.study_description && (
                          <p className="text-xs text-slate-600">Açıklama: {detail.study.study_description}</p>
                        )}
                        {detail.blocked && (
                          <p className="text-xs text-rose-700">Engellendi: {detail.block_reason || 'DICOM doğrulama hatası'}</p>
                        )}
                        {detail.quarantined_files?.length > 0 && (
                          <ul className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            {detail.quarantined_files.map((f) => (
                              <li key={f.relative_path} className="truncate">
                                {f.original_filename}{' '}
                                <span className="text-slate-400">({Math.max(1, Math.round(f.size_bytes / 1024))} KB)</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {detailFrames.length > 0 && (
                          <div>
                            <p className="mb-2 text-xs font-medium text-slate-600">Önizleme (görüntüleme amaçlı)</p>
                            <div className="flex flex-wrap gap-2">
                              {detailFrames.slice(0, 6).map((f) => (
                                <div
                                  key={f.sopInstanceUid || f.fileName}
                                  className="overflow-hidden rounded-lg border border-slate-200 bg-navy-950"
                                >
                                  {f.thumbUrl ? (
                                    <img src={f.thumbUrl} alt={f.fileName} className="h-24 w-24 object-contain" />
                                  ) : (
                                    <div className="flex h-24 w-24 items-center justify-center text-[10px] text-slate-400">
                                      {f.modality || 'DCM'}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!detailFrames.length && !detail.blocked && (
                          <p className="text-xs text-slate-500">
                            Metadata okundu. Piksel önizleme yoksa dosyalar metadata-only veya decode edilemedi.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
