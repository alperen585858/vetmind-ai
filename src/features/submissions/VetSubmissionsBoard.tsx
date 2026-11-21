import { useEffect, useMemo, useState, type ReactNode, useRef } from 'react'
import { LocalizedLink } from '../../components/LocalizedLink'
import { AlertTriangle, FileImage, Loader2, PawPrint, Search, Trash2, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { fmtDate } from '../../lib/format'
import { useLocale } from '../../context/LocaleContext'
import type { TranslateFn } from '../../i18n'
import { modalityLabel, regionLabel, studyLabel } from '../../lib/displayClean'
import type { BackendImagingSubmission, BackendPet, DicomIngestionRecord } from '../../types'
import type { DicomFramePreview } from '../../lib/dicomPreview'

/** Soft clinical status chips — muted, not loud. */
const STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  pending_verification: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/80',
  needs_info: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200/80',
  verified: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200/80',
  rejected: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  linked: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200/80',
}

type VetTab = 'all' | 'action' | 'waiting' | 'done'
type DetailTab = 'genel' | 'dicom' | 'klinik' | 'gecmis'

function speciesTr(species: string | null | undefined, t: TranslateFn) {
  if (!species) return ''
  if (species === 'feline' || species === 'Kedi') return t('pets.speciesFeline')
  if (species === 'canine' || species === 'Köpek') return t('pets.speciesCanine')
  return species
}

function vetStatusLabel(status: string, t: TranslateFn) {
  const key = `submissions.vetStatus.${status}`
  const label = t(key)
  return label === key ? status : label
}

function emptyTabTitle(tab: VetTab, t: TranslateFn) {
  const map: Record<VetTab, string> = {
    all: t('vetBoard.emptyAll'),
    action: t('vetBoard.emptyAction'),
    waiting: t('vetBoard.emptyWaiting'),
    done: t('vetBoard.emptyDone'),
  }
  return map[tab]
}

function ownerLocal(subject?: string | null) {
  if (!subject) return ''
  return subject.includes('@') ? subject.split('@')[0] : subject
}

function PetAvatar({
  name,
  species,
  size = 'md',
  t,
}: {
  name: string
  species?: string | null
  size?: 'md' | 'lg'
  t: TranslateFn
}) {
  const dim = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'
  const feline = species === 'feline' || species === 'Kedi'
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${dim} ${
        feline ? 'bg-navy-100 text-navy-700' : 'bg-teal-50 text-teal-800'
      }`}
      aria-hidden
      title={speciesTr(species, t) || undefined}
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

function RowSkeleton({ dark = false }: { dark?: boolean }) {
  const bone = dark ? 'bg-white/10' : 'bg-slate-100'
  return (
    <div className="animate-pulse flex items-center gap-3 px-3 py-3">
      <div className={`h-10 w-10 shrink-0 rounded-xl ${bone}`} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`h-3.5 w-28 rounded ${bone}`} />
        <div className={`h-3 w-40 rounded ${bone}`} />
      </div>
      <div className={`h-5 w-16 rounded-lg ${bone}`} />
    </div>
  )
}

function DicomReviewPanel({
  detail,
  frames,
  loading,
  error,
  t,
}: {
  detail: DicomIngestionRecord | null
  frames: DicomFramePreview[]
  loading: boolean
  error: string | null
  t: TranslateFn
}) {
  const [activeFrame, setActiveFrame] = useState(0)

  useEffect(() => {
    setActiveFrame(0)
  }, [detail?.ingest_id, frames.length])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-teal-700" /> {t('vetBoard.dicomLoading')}
      </div>
    )
  }

  if (error) {
    return <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
  }

  if (!detail) {
    return <p className="text-sm text-slate-500">{t('vetBoard.dicomNotLoaded')}</p>
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
            <p className="font-semibold">{t('submissions.board.dicomBlocked')}</p>
            <p className="mt-0.5 text-rose-800">{detail.block_reason || t('submissions.board.validationError')}</p>
          </div>
        </div>
      )}

      {!detail.blocked && detail.accepted && detail.case_id && (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm text-teal-900">
          Vakaya bağlı ·{' '}
          <LocalizedLink className="font-medium underline" to={`/vakalar/${detail.case_id}`}>
            {detail.case_id}
          </LocalizedLink>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            DICOM hasta
          </p>
          <div className="space-y-2">
            <Field label={t('submissions.board.name')} value={detail.patient_name || '—'} />
            <Field
              label={t('submissions.board.speciesBreed')}
              value={[speciesTr(detail.species, t) || detail.species, detail.breed].filter(Boolean).join(' · ') || '—'}
            />
            {detail.clinical_history ? <Field label={t('submissions.board.clinicalHistory')} value={detail.clinical_history} /> : null}
            {detail.referring_clinic ? <Field label={t('submissions.board.referringClinic')} value={detail.referring_clinic} /> : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Sınıflandırma
          </p>
          {detail.classification ? (
            <div className="space-y-2">
              <Field label={t('submissions.board.modality')} value={modalityLabel(t, detail.classification.suggested_modality)} />
              <Field label={t('submissions.board.region')} value={regionLabel(t, detail.classification.suggested_anatomical_region)} />
              <Field
                label={t('submissions.board.confidence')}
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
            <p className="text-sm text-slate-500">{t('submissions.board.noClassification')}</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 px-3.5 py-3">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Study</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-slate-400">{t('submissions.board.description')}</dt>
            <dd className="font-medium text-navy-900">{detail.study?.study_description || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">Accession</dt>
            <dd className="font-medium text-navy-900">{detail.study?.accession_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-400">{t('submissions.board.seriesInstances')}</dt>
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
              ? t('submissions.board.blockedNoPreview')
              : t('submissions.board.metadataOnly')}
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
  const { t } = useLocale()
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

  // Pick the default tab once per selected submission. Re-running on every `rows` reload
  // (after each action) used to throw the user back to the first tab.
  const tabInitFor = useRef<string | null>(null)
  useEffect(() => {
    const row = selectedId ? rows.find((r) => r.submission_id === selectedId) : null
    if (!selectedId) {
      tabInitFor.current = null
      return
    }
    if (tabInitFor.current === selectedId || !row) return
    tabInitFor.current = selectedId
    setInfoOpen(false)
    setDetailTab(row.dicom_ingest_id ? 'dicom' : 'genel')
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
    return t('vetBoard.patientFallback')
  }

  const ownerLine = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    const owner = ownerLocal(s.pet_owner_subject)
    if (pet?.name && owner) return owner
    return ''
  }

  const metaLine = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    return [
      speciesTr(pet?.species, t),
      pet?.breed,
      pet?.age_years != null ? t('vetBoard.yearsOld', { years: pet.age_years }) : null,
      pet?.sex,
    ]
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
    { id: 'all' as const, label: t('vetBoard.tabAll'), n: counts.all },
    { id: 'action' as const, label: t('vetBoard.tabAction'), n: counts.action },
    { id: 'waiting' as const, label: t('vetBoard.tabWaiting'), n: counts.waiting },
    { id: 'done' as const, label: t('vetBoard.tabDone'), n: counts.done },
  ]

  const renderRow = (s: BackendImagingSubmission, inRail: boolean) => {
    const active = detailOpen && s.submission_id === selected?.submission_id
    const name = displayName(s)
    const pet = petById.get(s.pet_id)
    const secondary = secondaryLine(s)
    const feline = pet?.species === 'feline' || pet?.species === 'Kedi'

    return (
      <li key={s.submission_id} id={`submission-${s.submission_id}`}>
        <button
          type="button"
          onClick={() => onSelect(s.submission_id)}
          className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
            inRail
              ? active
                ? 'bg-white/15 ring-1 ring-inset ring-teal-300/40'
                : 'hover:bg-white/8'
              : active
                ? 'bg-teal-50/70 ring-1 ring-inset ring-teal-300/50'
                : 'hover:bg-slate-50'
          } ${inRail ? 'rounded-xl' : 'border-b border-slate-100 last:border-0'}`}
        >
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
              inRail
                ? feline
                  ? 'bg-sky-400/90 text-navy-950'
                  : 'bg-teal-400 text-navy-950'
                : feline
                  ? 'bg-navy-100 text-navy-700'
                  : 'bg-teal-50 text-teal-800'
            }`}
            aria-hidden
          >
            {(name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className={`truncate text-sm font-semibold ${inRail ? 'text-white' : 'text-navy-900'}`}>{name}</p>
              <span className={`shrink-0 text-[11px] ${inRail ? 'text-slate-400' : 'text-slate-400'}`}>
                {fmtDate(s.updated_at || s.created_at)}
              </span>
            </div>
            {secondary ? (
              <p className={`mt-0.5 truncate text-xs ${inRail ? 'text-slate-400' : 'text-slate-500'}`}>{secondary}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                  inRail
                    ? s.status === 'pending_verification'
                      ? 'bg-amber-400/20 text-amber-200'
                      : s.status === 'needs_info'
                        ? 'bg-orange-400/20 text-orange-200'
                        : 'bg-white/10 text-slate-300'
                    : STATUS_PILL[s.status] || STATUS_PILL.draft
                }`}
              >
                {vetStatusLabel(s.status, t)}
              </span>
              {s.dicom_ingest_id ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-semibold ${
                    inRail ? 'bg-teal-400/20 text-teal-200' : 'bg-teal-50 text-teal-800'
                  }`}
                >
                  <FileImage className="h-3 w-3" /> {t('vetBoard.dicomBadge')}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-medium ${
                    inRail ? 'text-slate-500' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {t('vetBoard.noDicomBadge')}
                </span>
              )}
            </div>
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="vm-fade-up relative -mx-1 space-y-4">
      {!detailOpen && (
        <section className="relative overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] px-5 py-6 text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)] sm:px-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(45,212,191,0.32),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(251,191,36,0.14),transparent_45%)]"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/90">
                {visible.length} / {rows.length}
              </p>
              <h1 className="mt-1 font-[family-name:var(--vm-font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
                {t('vetBoard.title')}
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-slate-300">{t('vetBoard.subtitle')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {filterTabs.map((ft) => {
                  const active = tab === ft.id
                  return (
                    <button
                      key={ft.id}
                      type="button"
                      onClick={() => setTab(ft.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? ft.id === 'action'
                            ? 'bg-amber-400 text-amber-950'
                            : ft.id === 'waiting'
                              ? 'bg-orange-400 text-orange-950'
                              : 'bg-teal-400 text-navy-950'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      }`}
                    >
                      {ft.label} <span className="opacity-80">{ft.n}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="relative w-full sm:max-w-sm">
              <span className="sr-only">{t('vetBoard.searchPlaceholder')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-200/70" aria-hidden />
              <input
                className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/20 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-300/50"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('vetBoard.searchPlaceholder')}
              />
            </label>
          </div>
        </section>
      )}

      <div
        className={
          detailOpen
            ? 'grid h-[calc(100dvh-7.5rem)] max-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-[1.75rem] shadow-[0_20px_50px_-28px_rgba(11,23,40,0.45)] xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]'
            : 'overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-slate-200/70'
        }
      >
        {/* List */}
        <div
          className={
            detailOpen
              ? 'relative flex min-h-0 flex-col overflow-hidden bg-[color:var(--vm-midnight,#0b1728)] text-white'
              : 'min-h-0'
          }
        >
          {detailOpen && (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(45,212,191,0.22),transparent_55%)]"
              />
              <div className="relative border-b border-white/10 px-4 pb-3 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/90">{t('vetBoard.title')}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {filterTabs.map((ft) => {
                    const active = tab === ft.id
                    return (
                      <button
                        key={ft.id}
                        type="button"
                        onClick={() => setTab(ft.id)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                          active ? 'bg-teal-400 text-navy-950' : 'bg-white/10 text-slate-300 hover:bg-white/15'
                        }`}
                      >
                        {ft.label} {ft.n}
                      </button>
                    )
                  })}
                </div>
                <label className="relative mt-3 block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    className="w-full rounded-xl border-0 bg-white/10 py-2 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/15 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-400/50"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('vetBoard.searchPlaceholder')}
                  />
                </label>
              </div>
            </>
          )}

          <div className={`relative min-h-0 flex-1 overflow-y-auto ${detailOpen ? 'px-2 pb-3' : ''}`}>
            {loading ? (
              <ul className={detailOpen ? 'space-y-0.5' : 'divide-y divide-slate-100'}>
                {Array.from({ length: detailOpen ? 5 : 6 }).map((_, i) => (
                  <li key={i}>
                    <RowSkeleton dark={detailOpen} />
                  </li>
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title={emptyTabTitle(tab, t)} />
            ) : (
              <ul className={detailOpen ? 'space-y-0.5' : ''}>{visible.map((s) => renderRow(s, detailOpen))}</ul>
            )}
          </div>
        </div>

        {/* Detail — closable; DICOM-first for verification */}
        {detailOpen && selected && (
          <div className="relative flex min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f0fdfa_0%,#f8fafc_35%,#ffffff_100%)]">
            <div className="flex shrink-0 items-start gap-3 border-b border-slate-200/80 bg-white/80 px-4 py-4 backdrop-blur-sm sm:px-5">
              <PetAvatar name={displayName(selected)} species={selectedPet?.species || detail?.species} size="lg" t={t} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-[family-name:var(--vm-font-display)] text-xl font-semibold text-navy-900">
                    {displayName(selected)}
                  </h2>
                  <span
                    className={`rounded-lg px-2.5 py-0.5 text-[11px] font-semibold ${
                      STATUS_PILL[selected.status] || STATUS_PILL.draft
                    }`}
                  >
                    {vetStatusLabel(selected.status, t)}
                  </span>
                </div>
                {metaLine(selected) ? (
                  <p className="mt-0.5 text-sm text-slate-500">{metaLine(selected)}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-400">{fmtDate(selected.created_at)}</p>
                {detail?.classification ? (
                  <p className="mt-1 text-xs font-medium text-teal-800">
                    {studyLabel(t, detail.classification.suggested_modality, detail.classification.suggested_anatomical_region)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onCloseDetail}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-navy-800"
                aria-label={t('vetBoard.closeDetailAria')}
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-slate-100 px-2">
              {(
                [
                  { id: 'dicom' as const, label: t('vetBoard.detailTabDicom') },
                  { id: 'genel' as const, label: t('vetBoard.detailTabGeneral') },
                  { id: 'klinik' as const, label: t('vetBoard.detailTabClinical') },
                  { id: 'gecmis' as const, label: t('vetBoard.detailTabHistory') },
                ] as const
              ).map((tabItem) => (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => setDetailTab(tabItem.id)}
                  className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                    detailTab === tabItem.id
                      ? 'border-teal-600 text-teal-800'
                      : 'border-transparent text-slate-500 hover:text-navy-800'
                  }`}
                >
                  {tabItem.label}
                  {tabItem.id === 'dicom' && selected.dicom_ingest_id ? (
                    <span className="ml-1.5 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                      {t('vetBoard.reviewBadge')}
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
                    t={t}
                  />
                ) : (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-sm text-amber-950">
                    {t('vetBoard.noDicomWarning')}
                  </p>
                ))}

              {detailTab === 'genel' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-soft">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sahip</p>
                      <div className="space-y-2">
                        <Field label={t('submissions.board.name')} value={ownerShort} />
                        <Field label="E-posta" value={selected.pet_owner_subject || '—'} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-soft">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label={t('submissions.board.name')} value={selectedPet?.name || displayName(selected)} />
                        <Field
                          label={t('submissions.board.species')}
                          value={speciesTr(selectedPet?.species || detail?.species, t) || '—'}
                        />
                        <Field label={t('submissions.board.breed')} value={selectedPet?.breed || detail?.breed || '—'} />
                        <Field
                          label={t('submissions.board.age')}
                          value={selectedPet?.age_years != null ? `${selectedPet.age_years}` : '—'}
                        />
                      </div>
                    </div>
                  </div>

                  {(selected.chief_complaint || selected.clinical_notes) && (
                    <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('submissions.board.clinicalNote')}</p>
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
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">{t('submissions.board.dicomSummary')}</p>
                        <p className="mt-1 text-sm text-navy-900">
                          {detail?.classification
                            ? studyLabel(t, detail.classification.suggested_modality, detail.classification.suggested_anatomical_region)
                            : detailLoading
                              ? t('submissions.board.loading')
                              : t('submissions.board.openFullReview')}
                          {detail?.study
                            ? ` · ${detail.study.series.length} seri`
                            : ''}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-teal-700">{t('submissions.board.review')}</span>
                    </button>
                  )}
                </>
              )}

              {detailTab === 'klinik' && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">{t('submissions.board.complaint')}</p>
                    <p className="mt-1 text-navy-900">{selected.chief_complaint || '—'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Notlar</p>
                    <p className="mt-1 whitespace-pre-wrap text-navy-900">{selected.clinical_notes || '—'}</p>
                  </div>
                  {selected.missing_info_request ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase text-amber-800">{t('submissions.board.requestedInfo')}</p>
                      <p className="mt-1 text-amber-950">{selected.missing_info_request}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {detailTab === 'gecmis' && (
                <div className="space-y-2">
                  {(selected.info_requests || []).length === 0 ? (
                    <p className="text-sm text-slate-500">{t('vetBoard.noHistory')}</p>
                  ) : (
                    (selected.info_requests || []).map((r) => (
                      <div key={r.request_id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                        <p className="text-[11px] font-medium text-slate-500">
                          {r.status} · {fmtDate(r.created_at)}
                        </p>
                        <p className="mt-1 text-navy-900">{r.body}</p>
                        {r.reply ? <p className="mt-1 text-teal-800">{t('vetBoard.replyPrefix', { text: r.reply })}</p> : null}
                      </div>
                    ))
                  )}
                  {selected.linked_case_id ? (
                    <LocalizedLink
                      className="inline-block text-sm font-medium text-teal-700 hover:underline"
                      to={`/vakalar/${selected.linked_case_id}`}
                    >
                      {t('vetBoard.goToCase')}
                    </LocalizedLink>
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
                      title={!selected.dicom_ingest_id ? t('vetBoard.dicomRequiredTitle') : undefined}
                    >
                      {t('vetBoard.verifyOpenCase')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === selected.submission_id}
                      onClick={() => setInfoOpen((v) => !v)}
                    >
                      {t('vetBoard.missingInfo')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-rose-700 hover:bg-rose-50"
                      disabled={busy === selected.submission_id}
                      onClick={() => onReject(selected.submission_id)}
                    >
                      {t('vetBoard.reject')}
                    </Button>
                    {canDelete(selected) && (
                      <Button
                        variant="ghost"
                        className="ml-auto text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        icon={<Trash2 className="h-4 w-4" />}
                        disabled={busy === selected.submission_id || busy === `del-${selected.submission_id}`}
                        onClick={() => onDelete(selected)}
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                  {!selected.dicom_ingest_id && (
                    <p className="text-xs text-amber-800">{t('vetBoard.dicomRequiredHint')}</p>
                  )}
                  {infoOpen && (
                    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
                      <label className="block min-w-0 flex-1 text-xs text-slate-600">
                        {t('common.notes')}
                        <input
                          className="input mt-1 !min-h-10 text-sm"
                          value={infoRequestText[selected.submission_id] || ''}
                          onChange={(e) =>
                            setInfoRequestText({
                              ...infoRequestText,
                              [selected.submission_id]: e.target.value,
                            })
                          }
                          placeholder={t('vetBoard.infoNotePlaceholder')}
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
                        {t('common.send')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.linked_case_id ? (
                    <LocalizedLink
                      to={`/vakalar/${selected.linked_case_id}`}
                      className="inline-flex min-h-11 items-center rounded-vm bg-accent px-3.5 text-sm font-medium text-white hover:bg-teal-700"
                    >
                      {t('vetBoard.openCase')}
                    </LocalizedLink>
                  ) : null}
                  {canDelete(selected) && (
                    <Button
                      variant="ghost"
                      className="text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={busy === `del-${selected.submission_id}`}
                      onClick={() => onDelete(selected)}
                    >
                      {t('common.delete')}
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
