import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Loader2, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import {
  createSubmission,
  listPets,
  listSubmissions,
  updateSubmission,
  uploadDicomDemo,
  vetSubmissionAction,
} from '../lib/backend'
import type { BackendImagingSubmission, BackendPet } from '../types'

const STATUS_TR: Record<string, string> = {
  draft: 'Taslak',
  pending_verification: 'Vet onayı bekliyor',
  needs_info: 'Eksik bilgi istendi',
  verified: 'Doğrulandı',
  rejected: 'Reddedildi',
  linked: 'Vakaya bağlandı',
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
  const [busy, setBusy] = useState<string | null>(null)

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

  const create = async () => {
    if (!petId) return
    setBusy('create')
    try {
      const sub = await createSubmission({
        pet_id: petId,
        chief_complaint: complaint || undefined,
        clinical_notes: notes || undefined,
      })
      // Demo DICOM fixture attach (owner upload path — still requires vet verify)
      const dicom = await uploadDicomDemo({
        kind: 'brain_mri',
        patientName: pets.find((p) => p.pet_id === petId)?.name || 'Pet',
        species: pets.find((p) => p.pet_id === petId)?.species === 'feline' ? 'Kedi' : 'Köpek',
        clinicalHistory: complaint || notes || 'Owner imaging request',
      })
      await updateSubmission(sub.submission_id, { dicom_ingest_id: dicom.ingest_id })
      pushToast({ tone: 'success', title: 'Başvuru gönderildi', body: 'Veteriner doğrulaması gerekir.' })
      setComplaint('')
      setNotes('')
      load()
    } catch (e) {
      pushToast({ tone: 'error', title: 'Başvuru başarısız', body: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  const act = async (id: string, action: 'accept' | 'reject' | 'request_info') => {
    setBusy(id)
    try {
      await vetSubmissionAction(id, {
        action,
        missing_info_request: action === 'request_info' ? 'Lütfen klinik öyküyü tamamlayın.' : undefined,
        assigned_reviewer_id: action === 'accept' ? 'expert@demo.local' : undefined,
        run_analyze: action === 'accept',
        vet_notes: action === 'accept' ? 'Klinik doğrulama tamam' : undefined,
      })
      pushToast({
        tone: action === 'accept' ? 'success' : 'info',
        title: action === 'accept' ? 'Doğrulandı · vaka açıldı' : action === 'reject' ? 'Reddedildi' : 'Eksik bilgi istendi',
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
        title={isOwner ? 'Görüntüleme taleplerim' : 'Sahip başvuruları'}
        subtitle={
          isOwner
            ? 'DICOM/belge yükleme · veteriner doğrulaması olmadan klinik işlem başlamaz'
            : 'Doğrula, eksik bilgi iste veya reddet — ardından radyolog ataması'
        }
        crumbs={[{ label: 'Panel', to: '/' }, { label: 'Başvurular' }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>
      )}

      {isOwner && (
        <Card className="mb-6 p-5">
          <CardHeader title="Yeni talep" icon={<UploadCloud className="h-5 w-5" />} />
          {pets.length === 0 ? (
            <p className="px-1 text-sm text-slate-600">
              Önce <Link className="font-medium text-teal-700 hover:underline" to="/hayvanlar">pet profili</Link> oluşturun.
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
              <Button onClick={() => void create()} disabled={!!busy || !petId}>
                {busy === 'create' ? 'Gönderiliyor…' : 'Talep + demo DICOM gönder'}
              </Button>
            </div>
          )}
        </Card>
      )}

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
              <li key={s.submission_id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-semibold text-navy-900">{STATUS_TR[s.status] ?? s.status}</p>
                  <p className="text-xs text-slate-500">
                    {s.submission_id} · pet {s.pet_id}
                    {s.dicom_ingest_id ? ' · DICOM ekli' : ''}
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
                {isVet && (s.status === 'pending_verification' || s.status === 'needs_info') && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'accept')}>
                      Doğrula + vaka aç
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'request_info')}>
                      Eksik bilgi
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy === s.submission_id} onClick={() => void act(s.submission_id, 'reject')}>
                      Reddet
                    </Button>
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
