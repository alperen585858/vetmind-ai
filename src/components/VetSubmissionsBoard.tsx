import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FileImage, Loader2, PawPrint, Search, Trash2, X } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { fmtDate } from '../lib/format'
import type { BackendImagingSubmission, BackendPet, DicomIngestionRecord } from '../types'
import type { DicomFramePreview } from '../lib/dicomPreview'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  pending_verification: 'Onay bekliyor',
  needs_info: 'Eksik bilgi',
  verified: 'Tamamlandı',
  rejected: 'Reddedildi',
  linked: 'Tamamlandı',
}

/** Soft clinical status chips — muted, not loud. */
const STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  pending_verification: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/80',
  needs_info: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200/80',
  verified: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200/80',
  rejected: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  linked: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200/80',
}

const STATUS_ACCENT: Record<string, string> = {
  draft: 'border-l-slate-200',
  pending_verification: 'border-l-amber-300',
  needs_info: 'border-l-orange-300',
  verified: 'border-l-teal-400',
  rejected: 'border-l-slate-300',
  linked: 'border-l-teal-400',
}

type VetTab = 'all' | 'action' | 'waiting' | 'done'
type DetailTab = 'genel' | 'dicom' | 'klinik' | 'gecmis'

const EMPTY_BY_TAB: Record<VetTab, string> = {
  all: 'Başvuru yok',
  action: 'Onay bekleyen başvuru yok',
  waiting: 'Eksik bilgi bekleyen başvuru yok',
  done: 'Tamamlanan başvuru yok',
}

function speciesTr(species?: string | null) {
  if (!species) return ''
  if (species === 'feline' || species === 'Kedi') return 'Kedi'
  if (species === 'canine' || species === 'Köpek') return 'Köpek'
  return species
}

function ownerLocal(subject?: string | null) {
  if (!subject) return ''
  return subject.includes('@') ? subject.split('@')[0] : subject
}

function PetAvatar({
  name,
  species,
  size = 'md',
}: {
  name: string
  species?: string | null
  size?: 'md' | 'lg'
}) {
  const dim = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'
  const feline = species === 'feline' || species === 'Kedi'
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${dim} ${
        feline ? 'bg-navy-100 text-navy-700' : 'bg-teal-50 text-teal-800'
      }`}
      aria-hidden
      title={speciesTr(species) || undefined}
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-navy-900">{value || '—'}</p>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200/90 bg-white p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-slate-100" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="h-4 w-24 rounded bg-slate-100" />
            <div className="h-5 w-20 rounded-full bg-slate-100" />
          </div>
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="h-5 w-28 rounded-md bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

function DicomReviewPanel({
  detail,
  frames,
  loading,
  error,
}: {
  detail: DicomIngestionRecord | null
  frames: DicomFramePreview[]
  loading: boolean
  error: string | null
}) {
  const [activeFrame, setActiveFrame] = useState(0)

  useEffect(() => {
    setActiveFrame(0)
  }, [detail?.ingest_id, frames.length])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-teal-700" /> DICOM yükleniyor…
      </div>
    )
  }

  if (error) {
    return <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
  }

  if (!detail) {
    return <p className="text-sm text-slate-500">DICOM kaydı henüz yüklenmedi.</p>
  }

  const series = detail.study?.series || []
  const instanceCount = series.reduce((n, s) => n + s.instances.length, 0)
  const selected = frames[activeFrame] || frames[0]

  return (
    <div className="space-y-4">
      {detail.blocked && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">DICOM engellendi</p>
            <p className="mt-0.5 text-rose-800">{detail.block_reason || 'Doğrulama hatası'}</p>
          </div>
        </div>
      )}

      {!detail.blocked && detail.accepted && detail.case_id && (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm text-teal-900">
          Vakaya bağlı ·{' '}
          <Link className="font-medium underline" to={`/vakalar/${detail.case_id}`}>
            {detail.case_id}
          </Link>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            DICOM hasta
          </p>
          <div className="space-y-2">
            <Field label="Ad" value={detail.patient_name || '—'} />
            <Field
              label="Tür / ırk"
              value={[speciesTr(detail.species) || detail.species, detail.breed].filter(Boolean).join(' · ') || '—'}
            />
            {detail.clinical_history ? <Field label="Klinik öykü" value={detail.clinical_history} /> : null}
            {detail.referring_clinic ? <Field label="Gönderen klinik" value={detail.referring_clinic} /> : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Sınıflandırma
          </p>
          {detail.classification ? (
            <div className="space-y-2">
              <Field label="Modalite" value={detail.classification.suggested_modality} />
              <Field label="Anatomik bölge" value={detail.classification.suggested_anatomical_region} />
              <Field
                label="Güven"
                value={`${detail.classification.confidence}${
                  detail.classification.needs_confirmation ? ' · onay gerekli' : ''
                }`}
              />
              {detail.classification.rationale?.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {detail.classification.rationale.slice(0, 4).map((r) => (
                    <li key={r}>· {r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sınıflandırma yok</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 px-3.5 py-3">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Study</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-slate-400">Açıklama</dt>
            <dd className="font-medium text-navy-900">{detail.study?.study_description || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Accession</dt>
            <dd className="font-medium text-navy-900">{detail.study?.accession_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Seri / instance</dt>
            <dd className="font-medium text-navy-900">
              {series.length} seri · {instanceCount} instance
              {detail.quarantined_files?.length
                ? ` · ${detail.quarantined_files.length} dosya`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Ingest</dt>
            <dd className="break-all font-mono text-[11px] text-navy-800">{detail.ingest_id}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-slate-400">Study UID</dt>
            <dd className="break-all font-mono text-[11px] text-navy-800">
              {detail.study?.study_instance_uid || '—'}
            </dd>
          </div>
        </dl>

        {series.length > 0 && (
          <ul className="mt-3 max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-white px-3 py-2">
            {series.map((ser, i) => (
              <li key={ser.series_instance_uid} className="text-xs text-slate-700">
                <span className="font-medium text-navy-900">
                  Seri {i + 1}
                  {ser.modality ? ` · ${ser.modality}` : ''}
                </span>
                {ser.series_description ? ` — ${ser.series_description}` : ''}
                <span className="text-slate-400"> · {ser.instances.length} frame</span>
                {ser.body_part_examined ? (
                  <span className="text-slate-500"> · {ser.body_part_examined}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail.issues?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Doğrulama uyarıları ({detail.issues.length})
          </p>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-amber-950">
            {detail.issues.map((iss, i) => (
              <li key={`${iss.code}-${i}`}>
                <span className="font-medium uppercase">{iss.severity}</span> · {iss.message}
                {iss.filename ? <span className="text-amber-700"> ({iss.filename})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.quarantined_files?.length > 0 && (
        <div className="rounded-xl border border-slate-200 px-3.5 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Dosyalar ({detail.quarantined_files.length})
          </p>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-slate-700">
            {detail.quarantined_files.map((f) => (
              <li key={f.relative_path} className="truncate">
                {f.original_filename}{' '}
                <span className="text-slate-400">
                  ({Math.max(1, Math.round(f.size_bytes / 1024))} KB · {f.content_kind})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Önizleme {frames.length ? `(${frames.length})` : ''}
        </p>
        {frames.length === 0 ? (
          <p className="text-sm text-slate-500">
            {detail.blocked
              ? 'Engellenmiş ingest — önizleme yok'
              : 'Metadata okundu. Piksel önizleme yoksa dosyalar decode edilemedi.'}
          </p>
        ) : (
          <div className="space-y-3">
            {selected && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-navy-950">
                {selected.thumbUrl ? (
                  <img
                    src={selected.thumbUrl}
                    alt={selected.fileName}
                    className="mx-auto max-h-64 w-full object-contain"
                  />
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-400">
                    {selected.modality || 'DCM'}
                  </div>
                )}
                <div className="border-t border-white/10 px-3 py-2 text-[11px] text-slate-300">
                  {[selected.modality, selected.seriesDescription, selected.fileName]
                    .filter(Boolean)
                    .join(' · ')}
                  {selected.rows && selected.cols ? ` · ${selected.cols}×${selected.rows}` : ''}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {frames.map((f, i) => (
                <button
                  key={f.sopInstanceUid || f.fileName || i}
                  type="button"
                  onClick={() => setActiveFrame(i)}
                  className={`overflow-hidden rounded-lg border bg-navy-950 transition ${
                    i === activeFrame
                      ? 'border-teal-400 ring-2 ring-teal-500/40'
                      : 'border-slate-200 hover:border-teal-300'
                  }`}
                >
                  {f.thumbUrl ? (
                    <img src={f.thumbUrl} alt="" className="h-16 w-16 object-contain" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center text-[10px] text-slate-400">
                      {f.modality || 'DCM'}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function VetSubmissionsBoard({
  rows,
  pets,
  loading,
  selectedId,
  onSelect,
  onCloseDetail,
  busy,
  infoRequestText,
  setInfoRequestText,
  onAccept,
  onRequestInfo,
  onReject,
  onDelete,
  canDelete,
  detail,
  detailFrames,
  detailLoading,
  detailError,
  onLoadDicom,
}: {
  rows: BackendImagingSubmission[]
  pets: BackendPet[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onCloseDetail: () => void
  busy: string | null
  infoRequestText: Record<string, string>
  setInfoRequestText: (next: Record<string, string>) => void
  onAccept: (id: string) => void
  onRequestInfo: (id: string) => void
  onReject: (id: string) => void
  onDelete: (s: BackendImagingSubmission) => void
  canDelete: (s: BackendImagingSubmission) => boolean
  detail: DicomIngestionRecord | null
  detailFrames: DicomFramePreview[]
  detailLoading: boolean
  detailError: string | null
  onLoadDicom: (ingestId: string) => void
}) {
  const [tab, setTab] = useState<VetTab>('action')
  const [q, setQ] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('genel')
  const [infoOpen, setInfoOpen] = useState(false)

  const petById = useMemo(() => {
    const m = new Map<string, BackendPet>()
    for (const p of pets) m.set(p.pet_id, p)
    return m
  }, [pets])

  const counts = useMemo(
    () => ({
      all: rows.length,
      action: rows.filter((r) => r.status === 'pending_verification').length,
      waiting: rows.filter((r) => r.status === 'needs_info').length,
      done: rows.filter((r) => r.status === 'linked' || r.status === 'verified' || r.status === 'rejected').length,
    }),
    [rows],
  )

  const visible = useMemo(() => {
    const filtered =
      tab === 'action'
        ? rows.filter((r) => r.status === 'pending_verification')
        : tab === 'waiting'
          ? rows.filter((r) => r.status === 'needs_info')
          : tab === 'done'
            ? rows.filter((r) => r.status === 'linked' || r.status === 'verified' || r.status === 'rejected')
            : rows
    const ql = q.trim().toLowerCase()
    const searched = !ql
      ? filtered
      : filtered.filter((s) => {
          const pet = petById.get(s.pet_id)
          const hay = [s.submission_id, s.pet_owner_subject, s.chief_complaint, pet?.name, pet?.breed]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return hay.includes(ql)
        })
    const rank = (s: BackendImagingSubmission) =>
      s.status === 'pending_verification' ? 0 : s.status === 'needs_info' ? 1 : 2
    return [...searched].sort((a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at))
  }, [rows, tab, q, petById])

  const selected = selectedId
    ? visible.find((r) => r.submission_id === selectedId) ||
      rows.find((r) => r.submission_id === selectedId) ||
      null
    : null
  const selectedPet = selected ? petById.get(selected.pet_id) : undefined
  const detailOpen = Boolean(selected)

  useEffect(() => {
    setInfoOpen(false)
    const row = selectedId
      ? rows.find((r) => r.submission_id === selectedId)
      : null
    setDetailTab(row?.dicom_ingest_id ? 'dicom' : 'genel')
  }, [selectedId, rows])

  useEffect(() => {
    const ingestId = selected?.dicom_ingest_id
    if (!ingestId || !detailOpen) return
    onLoadDicom(ingestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.dicom_ingest_id, detailOpen])

  const displayName = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    if (pet?.name) return pet.name
    const owner = ownerLocal(s.pet_owner_subject)
    if (owner) return owner
    const clinical = (s.chief_complaint || '').trim()
    if (clinical) return clinical.slice(0, 24)
    return 'Hasta'
  }

  const ownerLine = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    const owner = ownerLocal(s.pet_owner_subject)
    if (pet?.name && owner) return owner
    return ''
  }

  const metaLine = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    return [speciesTr(pet?.species), pet?.breed, pet?.age_years != null ? `${pet.age_years} yaş` : null, pet?.sex]
      .filter(Boolean)
      .join(' · ')
  }

  const secondaryLine = (s: BackendImagingSubmission) => {
    const owner = ownerLine(s)
    const meta = metaLine(s)
    return [owner, meta].filter(Boolean).join(' · ')
  }

  const actionable =
    selected && (selected.status === 'pending_verification' || selected.status === 'needs_info')

  const ownerShort = ownerLocal(selected?.pet_owner_subject) || '—'

  const filterTabs = [
    { id: 'all' as const, label: 'Tümü', n: counts.all },
    { id: 'action' as const, label: 'Onay bekleyen', n: counts.action },
    { id: 'waiting' as const, label: 'Eksik bilgi', n: counts.waiting },
    { id: 'done' as const, label: 'Tamamlanan', n: counts.done },
  ]

  const renderCard = (s: BackendImagingSubmission) => {
    const active = detailOpen && s.submission_id === selected?.submission_id
    const name = displayName(s)
    const pet = petById.get(s.pet_id)
    const secondary = secondaryLine(s)

    return (
      <li key={s.submission_id} id={`submission-${s.submission_id}`}>
        <button
          type="button"
          onClick={() => onSelect(s.submission_id)}
          className={`flex w-full items-start gap-3 rounded-xl border border-l-4 border-slate-200/90 bg-white px-3.5 py-3.5 text-left shadow-soft transition ${
            STATUS_ACCENT[s.status] || STATUS_ACCENT.draft
          } ${
            active
              ? 'bg-teal-50/40 ring-2 ring-teal-500/30'
              : 'hover:-translate-y-0.5 hover:border-teal-200/80 hover:shadow-md'
          }`}
        >
          <PetAvatar name={name} species={pet?.species} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-navy-900">{name}</p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  STATUS_PILL[s.status] || STATUS_PILL.draft
                }`}
              >
                {STATUS_LABEL[s.status] || s.status}
              </span>
            </div>
            {secondary ? (
              <p className="mt-1 truncate text-xs text-slate-500">{secondary}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              {s.dicom_ingest_id ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 font-medium text-teal-800">
                  <FileImage className="h-3 w-3" /> DICOM
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">
                  DICOM yok
                </span>
              )}
              <span className="text-slate-400">{fmtDate(s.updated_at || s.created_at)}</span>
            </div>
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900">Sahip Başvuruları</h1>
          <p className="mt-1 text-sm text-slate-500">Onay ve eksik bilgi bekleyen sahip talepleri</p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input !min-h-10 border-slate-200 bg-white pl-9 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hasta veya başvuru ara…"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100/90 p-1">
        {filterTabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                active
                  ? 'bg-white text-navy-900 shadow-sm ring-1 ring-teal-200/70'
                  : 'text-slate-600 hover:text-navy-800'
              }`}
            >
              {t.label}
              <span
                className={`tabular-nums rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                  active ? 'bg-teal-50 text-teal-800' : 'text-slate-400'
                }`}
              >
                {t.n}
              </span>
            </button>
          )
        })}
      </div>

      <div
        className={`grid gap-4 ${
          detailOpen ? 'xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]' : 'grid-cols-1'
        }`}
      >
        {/* List — separate cards when detail closed; compact queue when open */}
        <div>
          {loading ? (
            <ul
              className={
                detailOpen
                  ? 'flex max-h-[min(72vh,42rem)] flex-col gap-2 overflow-y-auto'
                  : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
              }
            >
              {Array.from({ length: detailOpen ? 4 : 6 }).map((_, i) => (
                <li key={i}>
                  <CardSkeleton />
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-soft">
              <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title={EMPTY_BY_TAB[tab]} />
            </div>
          ) : (
            <ul
              className={
                detailOpen
                  ? 'flex max-h-[min(72vh,42rem)] flex-col gap-2 overflow-y-auto'
                  : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
              }
            >
              {visible.map((s) => renderCard(s))}
            </ul>
          )}
        </div>

        {/* Detail — closable; DICOM-first for verification */}
        {detailOpen && selected && (
          <div className="flex max-h-[min(82vh,52rem)] flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-soft">
            <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
              <PetAvatar name={displayName(selected)} species={selectedPet?.species || detail?.species} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold text-navy-900">{displayName(selected)}</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      STATUS_PILL[selected.status] || STATUS_PILL.draft
                    }`}
                  >
                    {STATUS_LABEL[selected.status] || selected.status}
                  </span>
                </div>
                {metaLine(selected) ? (
                  <p className="mt-0.5 text-sm text-slate-500">{metaLine(selected)}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-400">{fmtDate(selected.created_at)}</p>
                {detail?.classification ? (
                  <p className="mt-1 text-xs font-medium text-teal-800">
                    {detail.classification.suggested_modality} ·{' '}
                    {detail.classification.suggested_anatomical_region}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onCloseDetail}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-navy-800"
                aria-label="Detayı kapat"
                title="Kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-slate-100 px-2">
              {(
                [
                  { id: 'dicom' as const, label: 'DICOM' },
                  { id: 'genel' as const, label: 'Genel' },
                  { id: 'klinik' as const, label: 'Klinik' },
                  { id: 'gecmis' as const, label: 'Geçmiş' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDetailTab(t.id)}
                  className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                    detailTab === t.id
                      ? 'border-teal-600 text-teal-800'
                      : 'border-transparent text-slate-500 hover:text-navy-800'
                  }`}
                >
                  {t.label}
                  {t.id === 'dicom' && selected.dicom_ingest_id ? (
                    <span className="ml-1.5 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                      incele
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {detailTab === 'dicom' &&
                (selected.dicom_ingest_id ? (
                  <DicomReviewPanel
                    detail={detail}
                    frames={detailFrames}
                    loading={detailLoading}
                    error={detailError}
                  />
                ) : (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-sm text-amber-950">
                    Bu başvuruya DICOM bağlı değil. Doğrulama için sahip yeniden yüklemeli.
                  </p>
                ))}

              {detailTab === 'genel' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-soft">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sahip</p>
                      <div className="space-y-2">
                        <Field label="Ad" value={ownerShort} />
                        <Field label="E-posta" value={selected.pet_owner_subject || '—'} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-soft">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Ad" value={selectedPet?.name || displayName(selected)} />
                        <Field
                          label="Tür"
                          value={speciesTr(selectedPet?.species || detail?.species) || '—'}
                        />
                        <Field label="Irk" value={selectedPet?.breed || detail?.breed || '—'} />
                        <Field
                          label="Yaş"
                          value={selectedPet?.age_years != null ? `${selectedPet.age_years}` : '—'}
                        />
                      </div>
                    </div>
                  </div>

                  {(selected.chief_complaint || selected.clinical_notes) && (
                    <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Klinik not</p>
                      <p className="mt-1 text-sm text-navy-900">
                        {selected.chief_complaint || selected.clinical_notes}
                      </p>
                    </div>
                  )}

                  {selected.dicom_ingest_id && (
                    <button
                      type="button"
                      onClick={() => setDetailTab('dicom')}
                      className="flex w-full items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/50 px-3.5 py-3 text-left transition hover:bg-teal-50"
                    >
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">DICOM özeti</p>
                        <p className="mt-1 text-sm text-navy-900">
                          {detail?.classification
                            ? `${detail.classification.suggested_modality} · ${detail.classification.suggested_anatomical_region}`
                            : detailLoading
                              ? 'Yükleniyor…'
                              : 'Tam incelemeye geç'}
                          {detail?.study
                            ? ` · ${detail.study.series.length} seri`
                            : ''}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-teal-700">İncele →</span>
                    </button>
                  )}
                </>
              )}

              {detailTab === 'klinik' && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Şikâyet</p>
                    <p className="mt-1 text-navy-900">{selected.chief_complaint || '—'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Notlar</p>
                    <p className="mt-1 whitespace-pre-wrap text-navy-900">{selected.clinical_notes || '—'}</p>
                  </div>
                  {selected.missing_info_request ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase text-amber-800">İstenen bilgi</p>
                      <p className="mt-1 text-amber-950">{selected.missing_info_request}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {detailTab === 'gecmis' && (
                <div className="space-y-2">
                  {(selected.info_requests || []).length === 0 ? (
                    <p className="text-sm text-slate-500">Kayıt yok</p>
                  ) : (
                    (selected.info_requests || []).map((r) => (
                      <div key={r.request_id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                        <p className="text-[11px] font-medium text-slate-500">
                          {r.status} · {fmtDate(r.created_at)}
                        </p>
                        <p className="mt-1 text-navy-900">{r.body}</p>
                        {r.reply ? <p className="mt-1 text-teal-800">Yanıt: {r.reply}</p> : null}
                      </div>
                    ))
                  )}
                  {selected.linked_case_id ? (
                    <Link
                      className="inline-block text-sm font-medium text-teal-700 hover:underline"
                      to={`/vakalar/${selected.linked_case_id}`}
                    >
                      Vakaya git →
                    </Link>
                  ) : null}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-5">
              {actionable ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy === selected.submission_id || !selected.dicom_ingest_id}
                      onClick={() => onAccept(selected.submission_id)}
                      title={!selected.dicom_ingest_id ? 'DICOM gerekli' : undefined}
                    >
                      Doğrula + Vaka Aç
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === selected.submission_id}
                      onClick={() => setInfoOpen((v) => !v)}
                    >
                      Eksik Bilgi
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-rose-700 hover:bg-rose-50"
                      disabled={busy === selected.submission_id}
                      onClick={() => onReject(selected.submission_id)}
                    >
                      Reddet
                    </Button>
                    {canDelete(selected) && (
                      <Button
                        variant="ghost"
                        className="ml-auto text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        icon={<Trash2 className="h-4 w-4" />}
                        disabled={busy === selected.submission_id || busy === `del-${selected.submission_id}`}
                        onClick={() => onDelete(selected)}
                      >
                        Sil
                      </Button>
                    )}
                  </div>
                  {!selected.dicom_ingest_id && (
                    <p className="text-xs text-amber-800">Doğrulama için DICOM gerekli.</p>
                  )}
                  {infoOpen && (
                    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
                      <label className="block min-w-0 flex-1 text-xs text-slate-600">
                        Not
                        <input
                          className="input mt-1 !min-h-10 text-sm"
                          value={infoRequestText[selected.submission_id] || ''}
                          onChange={(e) =>
                            setInfoRequestText({
                              ...infoRequestText,
                              [selected.submission_id]: e.target.value,
                            })
                          }
                          placeholder="Eksik bilgiyi yazın…"
                          autoFocus
                        />
                      </label>
                      <Button
                        size="sm"
                        disabled={busy === selected.submission_id}
                        onClick={() => {
                          onRequestInfo(selected.submission_id)
                          setInfoOpen(false)
                        }}
                      >
                        Gönder
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.linked_case_id ? (
                    <Link
                      to={`/vakalar/${selected.linked_case_id}`}
                      className="inline-flex min-h-11 items-center rounded-vm bg-accent px-3.5 text-sm font-medium text-white hover:bg-teal-700"
                    >
                      Vakayı aç
                    </Link>
                  ) : null}
                  {canDelete(selected) && (
                    <Button
                      variant="ghost"
                      className="text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={busy === `del-${selected.submission_id}`}
                      onClick={() => onDelete(selected)}
                    >
                      Sil
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
