import { useEffect, useRef, useState, type DragEvent, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Eye, FileText, FolderOpen, Loader2, UploadCloud, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import {
  createSubmission,
  fetchIngestDicomFiles,
  getDicomIngestion,
  listPets,
  listSubmissions,
  updateSubmission,
  uploadDicomDemo,
  uploadDicomFiles,
  vetSubmissionAction,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import type { BackendImagingSubmission, BackendPet, DicomIngestionRecord, Species } from '../types'

const STATUS_TR: Record<string, string> = {
  draft: 'Taslak',
  pending_verification: 'Vet onayı bekliyor',
  needs_info: 'Eksik bilgi istendi',
  verified: 'Doğrulandı',
  rejected: 'Reddedildi',
  linked: 'Vakaya bağlandı',
}

function petSpeciesLabel(species?: string | null): Species {
  return species === 'feline' ? 'Kedi' : 'Köpek'
}

function collectFiles(list: FileList | null): File[] {
  if (!list?.length) return []
  return Array.from(list).filter((f) => f.size > 0)
}

export default function Submissions() {
  const { role, pushToast } = useApp()
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
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null)
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
    return updateSubmission(sub.submission_id, { dicom_ingest_id: dicom.ingest_id })
  }

  const create = async (useDemo: boolean) => {
    if (!petId) return
    if (!useDemo && files.length === 0) {
      pushToast({
        tone: 'error',
        title: 'DICOM seçilmedi',
        body: 'Kendi .dcm dosyalarınızı ekleyin veya demo DICOM kullanın.',
      })
      return
    }
    setBusy('create')
    try {
      const sub = await createSubmission({
        pet_id: petId,
        chief_complaint: complaint || undefined,
        clinical_notes: notes || undefined,
      })
      const linked = await uploadAndLink(sub, useDemo ? { demo: true } : { files })
      pushToast({
        tone: 'success',
        title: useDemo ? 'Başvuru + demo DICOM gönderildi' : 'Başvuru + DICOM gönderildi',
        body: `Ingest ${linked.dicom_ingest_id} · veteriner doğrulaması gerekir.`,
      })
      setComplaint('')
      setNotes('')
      setFiles([])
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Başvuru/DICOM başarısız', body: e instanceof Error ? e.message : undefined })
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
        missing_info_request: action === 'request_info' ? 'Lütfen klinik öyküyü tamamlayın.' : undefined,
        assigned_reviewer_id: action === 'accept' ? 'expert@demo.local' : undefined,
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
            ? 'Dosya seçin, talebi gönderin — veteriner onayından sonra işlem başlar'
            : 'Doğrula · radyoloğa ata · veya eksik bilgi iste'
        }
        crumbs={[{ label: 'Ana sayfa', to: '/' }, { label: isOwner ? 'DICOM yükle' : 'Başvurular' }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      )}

      {isOwner && (
        <Card className="mb-6 p-5">
          <CardHeader title="Yeni DICOM talebi" icon={<UploadCloud className="h-5 w-5" />} />
          {pets.length === 0 ? (
            <p className="px-1 text-sm text-slate-600">
              Önce{' '}
              <Link className="font-medium text-teal-700 hover:underline" to="/hayvanlar">
                pet profili
              </Link>{' '}
              oluşturun.
            </p>
          ) : (
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
                <textarea className="input mt-1 min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>

              <div className="sm:col-span-2">
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
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Dosya seç
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<FolderOpen className="h-3.5 w-3.5" />}
                      onClick={() => folderInputRef.current?.click()}
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
                      addFiles(collectFiles(e.target.files))
                      e.target.value = ''
                    }}
                    {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
                  />
                </div>

                {files.length > 0 && (
                  <ul className="mt-3 max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-white px-3 py-2">
                    {files.map((f) => (
                      <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-2 text-xs text-slate-700">
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
              </div>

              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button onClick={() => void create(false)} disabled={!!busy || !petId || files.length === 0}>
                  {busy === 'create' ? 'Gönderiliyor…' : `Talep + DICOM gönder${files.length ? ` (${files.length})` : ''}`}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void create(true)}
                  disabled={!!busy || !petId}
                >
                  Demo DICOM ile gönder
                </Button>
              </div>
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
            {rows.map((s) => (
              <li key={s.submission_id} className="px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-semibold text-navy-900">{STATUS_TR[s.status] ?? s.status}</p>
                    <p className="text-xs text-slate-500">
                      {s.submission_id} · pet {s.pet_id}
                      {s.pet_owner_subject ? ` · sahip ${s.pet_owner_subject}` : ''}
                      {s.dicom_ingest_id ? ' · DICOM ekli' : ' · DICOM yok'}
                      {s.linked_case_id ? (
                        <>
                          {' '}
                          · vaka{' '}
                          <Link className="text-teal-700 hover:underline" to={`/vakalar/${s.linked_case_id}`}>
                            {s.linked_case_id}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-slate-700">{s.chief_complaint || s.clinical_notes || '—'}</p>
                    {s.missing_info_request && (
                      <p className="mt-1 text-xs text-amber-800">Eksik: {s.missing_info_request}</p>
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
                    {isOwner &&
                      !s.dicom_ingest_id &&
                      (s.status === 'pending_verification' || s.status === 'needs_info' || s.status === 'draft') && (
                      <>
                        <Button size="sm" disabled={busy === s.submission_id} onClick={() => openAttachPicker(s.submission_id)}>
                          {busy === s.submission_id ? 'Yükleniyor…' : 'DICOM dosya ekle'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === s.submission_id}
                          onClick={() => void attachDemo(s.submission_id)}
                        >
                          Demo DICOM
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
                  </div>
                </div>

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
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
