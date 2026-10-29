import { useCallback, useEffect, useRef, useState, type DragEvent, type InputHTMLAttributes } from 'react'
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
import { fmtDate } from '../lib/format'
import { useApp } from '../context/AppContext'
import { demoEmailForRole } from '../lib/auth'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { StepIndicator } from '../components/StepIndicator'
import { DEMO_PRICE_LABEL, DemoPaymentStep } from '../components/DemoPaymentStep'
import { VetSubmissionsBoard } from '../components/VetSubmissionsBoard'
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

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  pending_verification: 'bg-amber-50 text-amber-900 ring-amber-200',
  needs_info: 'bg-orange-50 text-orange-900 ring-orange-200',
  verified: 'bg-teal-50 text-teal-800 ring-teal-200',
  rejected: 'bg-rose-50 text-rose-800 ring-rose-200',
  linked: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
}

/** User-facing Turkish message; keep raw text for debugging. */
function presentError(raw: string): { message: string; technical: string } {
  const t = raw.trim()
  const lower = t.toLowerCase()
  if (!t) return { message: 'Beklenmeyen bir hata oluştu.', technical: t }
  if (
    lower.includes('internal server error') ||
    lower === '500' ||
    /\b500\b/.test(t) ||
    lower.includes('server error')
  ) {
    return {
      message: 'Sunucu şu an işlemi tamamlayamadı. Lütfen kısa süre sonra tekrar deneyin.',
      technical: t,
    }
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network')) {
    return {
      message: 'Bağlantı kurulamadı. Ağınızı kontrol edip yeniden deneyin.',
      technical: t,
    }
  }
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return {
      message: 'Bu işlem için yetkiniz yok veya oturumunuz sona ermiş olabilir.',
      technical: t,
    }
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      message: 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.',
      technical: t,
    }
  }
  return { message: t, technical: t }
}

function ErrorDetails({ raw }: { raw: string }) {
  const { message, technical } = presentError(raw)
  const showTech = technical && technical !== message
  return (
    <div className="space-y-1">
      <p>{message}</p>
      {showTech && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none hover:text-slate-700">Teknik ayrıntı</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100/80 p-2 font-mono">
            {technical}
          </pre>
        </details>
      )}
    </div>
  )
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
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [detailIngestId, setDetailIngestId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DicomIngestionRecord | null>(null)
  const [detailFrames, setDetailFrames] = useState<DicomFramePreview[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    void Promise.all([listSubmissions(), isOwner || isVet ? listPets().catch(() => []) : Promise.resolve([])])
      .then(([subs, p]) => {
        setRows(subs)
        setPets(p)
        if (p[0] && !petId) setPetId(p[0].pet_id)
        setSelectedSubmissionId((prev) => {
          if (routeSubmissionId && subs.some((s) => s.submission_id === routeSubmissionId)) return routeSubmissionId
          if (prev && subs.some((s) => s.submission_id === prev)) return prev
          return null
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Liste yüklenemedi'))
      .finally(() => setLoading(false))
  }

  const toastError = (title: string, err: unknown) => {
    const raw = err instanceof Error ? err.message : 'Beklenmeyen hata'
    const { message, technical } = presentError(raw)
    pushToast({
      tone: 'error',
      title,
      body: message === technical ? message : `${message} (${technical})`,
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  useEffect(() => {
    if (!routeSubmissionId) return
    setSelectedSubmissionId(routeSubmissionId)
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
              title: 'Ödeme onaylandı',
              body: 'Önceki onaylı ödeme korundu.',
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
        body: 'Kendi .dcm dosyalarınızı ekleyin veya örnek DICOM kullanın.',
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
      toastError('Ödeme adımı hazırlanamadı', e)
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
      toastError('DICOM eklenemedi', e)
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
        title: 'Örnek DICOM eklendi',
        body: `Ingest ${linked.dicom_ingest_id} · veteriner doğrulaması gerekir.`,
      })
      load()
    } catch (e) {
      toastError('DICOM eklenemedi', e)
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
      toastError('Belge eklenemedi', e)
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
      toastError('Yanıt gönderilemedi', e)
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
      toastError('Kapatılamadı', e)
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
      toastError('Silinemedi', e)
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

  const loadedDicomRef = useRef<string | null>(null)

  const loadDicomDetail = useCallback(async (ingestId: string) => {
    if (loadedDicomRef.current === ingestId) return
    loadedDicomRef.current = ingestId
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
      loadedDicomRef.current = null
      setDetailError(e instanceof Error ? e.message : 'DICOM detayı yüklenemedi')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const openDicomDetail = async (ingestId: string) => {
    if (detailIngestId === ingestId) {
      loadedDicomRef.current = null
      closeDicomDetail()
      return
    }
    loadedDicomRef.current = null
    await loadDicomDetail(ingestId)
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
      toastError('İşlem başarısız', e)
    } finally {
      setBusy(null)
    }
  }

  if (isVet) {
    return (
      <>
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <ErrorDetails raw={error} />
          </div>
        )}
        <VetSubmissionsBoard
          rows={rows}
          pets={pets}
          loading={loading}
          selectedId={selectedSubmissionId}
          onSelect={(id) => {
            setSelectedSubmissionId(id)
            navigate(`/basvurular/${id}`, { replace: true })
          }}
          onCloseDetail={() => {
            setSelectedSubmissionId(null)
            navigate('/basvurular', { replace: true })
          }}
          busy={busy}
          infoRequestText={infoRequestText}
          setInfoRequestText={setInfoRequestText}
          onAccept={(id) => void act(id, 'accept')}
          onRequestInfo={(id) => void act(id, 'request_info')}
          onReject={(id) => void act(id, 'reject')}
          onDelete={(s) => void removeSubmission(s)}
          canDelete={canDelete}
          detail={detail}
          detailFrames={detailFrames}
          detailLoading={detailLoading}
          detailError={detailError}
          onLoadDicom={(ingestId) => void loadDicomDetail(ingestId)}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="DICOM yükle"
        subtitle={`Hasta bilgileri → DICOM → özet → ödeme (${DEMO_PRICE_LABEL}) → radyoloji iş akışı`}
        crumbs={[{ label: 'Ana sayfa', to: '/' }, { label: 'DICOM yükle' }]}
      />
      {error && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <ErrorDetails raw={error} />
        </div>
      )}

      {isOwner && (
        <Card className="mb-6 p-5">
          <CardHeader
            title="Yeni görüntüleme talebi"
            subtitle={`Ödeme (${DEMO_PRICE_LABEL}) sonrası radyoloji iş akışına gönderilir`}
            icon={<UploadCloud className="h-5 w-5" />}
          />
          {pets.length === 0 ? (
            <p className="px-1 text-sm text-slate-600">
              Önce{' '}
              <Link
                className={`font-medium hover:underline ${isOwner ? 'text-sky-700' : 'text-teal-700'}`}
                to="/hayvanlar"
              >
                pet profili
              </Link>{' '}
              oluşturun.
            </p>
          ) : (
            <div className="space-y-5">
              <StepIndicator
                steps={WIZARD_STEPS}
                current={wizardStep}
                accent={isOwner ? 'sky' : 'teal'}
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
                        ? isOwner
                          ? 'border-sky-500 bg-sky-50'
                          : 'border-teal-600 bg-teal-50'
                        : isOwner
                          ? 'border-slate-200 bg-slate-50/80 hover:border-sky-400'
                          : 'border-slate-200 bg-slate-50/80 hover:border-teal-400'
                    }`}
                  >
                    <UploadCloud
                      className={`mx-auto h-8 w-8 ${
                        drag
                          ? isOwner
                            ? 'text-sky-700'
                            : 'text-teal-700'
                          : isOwner
                            ? 'text-sky-600'
                            : 'text-teal-600'
                      }`}
                    />
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
                        Örnek DICOM kullan
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
                    <p
                      className={`rounded-lg px-3 py-2 text-sm ${
                        isOwner
                          ? 'border border-sky-200 bg-sky-50 text-sky-950'
                          : 'border border-teal-200 bg-teal-50 text-teal-900'
                      }`}
                    >
                      Örnek brain MRI DICOM kullanılacak.
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
                        <dd className="font-semibold text-navy-900">{DEMO_PRICE_LABEL}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">Şikâyet / notlar</dt>
                        <dd className="text-slate-800">{complaint || notes || '—'}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">DICOM</dt>
                        <dd className="text-slate-800">
                          {useDemoDicom
                            ? 'Örnek brain MRI'
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
                        title: 'Ödeme onaylandı',
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
        <CardHeader title="Başvuru listesi" subtitle={loading ? undefined : `${rows.length} kayıt`} icon={<ClipboardCheck className="h-5 w-5" />} />
        {loading ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<ClipboardCheck className="h-5 w-5" />} title="Başvuru yok" text="Henüz kayıt bulunmuyor." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => {
              const highlighted = routeSubmissionId === s.submission_id
              const pet = pets.find((p) => p.pet_id === s.pet_id)
              const statusCls = STATUS_PILL[s.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
              return (
                <li
                  id={`submission-${s.submission_id}`}
                  key={s.submission_id}
                  className={`px-4 py-3 ${highlighted ? 'bg-teal-50/70' : ''}`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusCls}`}>
                          {STATUS_TR[s.status] ?? s.status}
                        </span>
                        <span className="truncate text-sm font-semibold text-navy-900">
                          {pet?.name || s.chief_complaint || 'Başvuru'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {s.dicom_ingest_id ? 'DICOM ekli' : 'DICOM yok'}
                        {' · '}
                        {fmtDate(s.updated_at || s.created_at)}
                        {s.linked_case_id ? (
                          <>
                            {' · '}
                            <Link className="text-teal-700 hover:underline" to={`/vakalar/${s.linked_case_id}`}>
                              Vakaya git
                            </Link>
                          </>
                        ) : null}
                      </p>
                      {s.missing_info_request && s.status === 'needs_info' && (
                        <p className="mt-1 text-xs text-amber-800">İstenen: {s.missing_info_request}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.dicom_ingest_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Eye className="h-3.5 w-3.5" />}
                          onClick={() => void openDicomDetail(s.dicom_ingest_id!)}
                        >
                          {detailIngestId === s.dicom_ingest_id ? 'Kapat' : 'DICOM'}
                        </Button>
                      )}
                      {canOwnerAttach(s) && (
                        <>
                          <Button size="sm" disabled={busy === s.submission_id} onClick={() => openAttachPicker(s.submission_id)}>
                            {s.dicom_ingest_id ? 'Ek DICOM' : 'DICOM ekle'}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy === s.submission_id} onClick={() => void attachDemo(s.submission_id)}>
                            Örnek
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<FileText className="h-3.5 w-3.5" />}
                            disabled={busy === s.submission_id}
                            onClick={() => openDocAttachPicker(s.submission_id)}
                          >
                            Belge
                          </Button>
                        </>
                      )}
                      {canDelete(s) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          disabled={busy === `del-${s.submission_id}`}
                          onClick={() => void removeSubmission(s)}
                        >
                          Sil
                        </Button>
                      )}
                    </div>
                  </div>
                  {s.status === 'needs_info' && (
                    <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                      <label className="block text-xs font-medium text-amber-950">
                        Veteriner isteğine yanıt
                        <textarea
                          className="input mt-1 min-h-[64px] text-sm"
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
                  {s.dicom_ingest_id && detailIngestId === s.dicom_ingest_id && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                      {detailLoading && (
                        <p className="flex items-center gap-2 text-sm text-slate-600">
                          <Loader2 className="h-4 w-4 animate-spin" /> DICOM detayları yükleniyor…
                        </p>
                      )}
                      {detailError && (
                        <div className="text-sm text-rose-700">
                          <ErrorDetails raw={detailError} />
                        </div>
                      )}
                      {!detailLoading && detail && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-navy-900">DICOM özeti</p>
                              <p className="text-xs text-slate-500">
                                {detail.accepted && detail.case_id
                                  ? `Vakaya bağlı · ${detail.case_id}`
                                  : 'Karantinada'}
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
                            <p className="text-xs text-rose-700">
                              Engellendi: {detail.block_reason || 'DICOM doğrulama hatası'}
                            </p>
                          )}
                          {detail.quarantined_files?.length > 0 && (
                            <ul className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                              {detail.quarantined_files.map((f) => (
                                <li key={f.relative_path} className="truncate">
                                  {f.original_filename}{' '}
                                  <span className="text-slate-400">
                                    ({Math.max(1, Math.round(f.size_bytes / 1024))} KB)
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {detailFrames.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-medium text-slate-600">Önizleme</p>
                              <div className="flex flex-wrap gap-2">
                                {detailFrames.slice(0, 6).map((f) => (
                                  <div
                                    key={f.sopInstanceUid || f.fileName}
                                    className="overflow-hidden rounded-lg border border-slate-200 bg-navy-950"
                                  >
                                    {f.thumbUrl ? (
                                      <img
                                        src={f.thumbUrl}
                                        alt={f.fileName}
                                        className="h-24 w-24 object-contain"
                                      />
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
