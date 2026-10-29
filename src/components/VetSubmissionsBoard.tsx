import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileImage, Loader2, PawPrint, Search, Trash2, X } from 'lucide-react'
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

function speciesTr(species?: string | null) {
  if (!species) return '—'
  if (species === 'feline' || species === 'Kedi') return 'Kedi'
  if (species === 'canine' || species === 'Köpek') return 'Köpek'
  return species
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
      title={speciesTr(species)}
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
    setDetailTab('genel')
  }, [selectedId])

  useEffect(() => {
    const ingestId = selected?.dicom_ingest_id
    if (!ingestId || !detailOpen) return
    if (detailTab === 'dicom' || detailTab === 'genel') onLoadDicom(ingestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.dicom_ingest_id, detailTab, detailOpen])

  const displayName = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    if (pet?.name) return pet.name
    const clinical = (s.chief_complaint || '').trim()
    if (clinical) return clinical.slice(0, 24)
    return s.pet_owner_subject?.split('@')[0] || 'Hasta'
  }

  const metaLine = (s: BackendImagingSubmission) => {
    const pet = petById.get(s.pet_id)
    return [speciesTr(pet?.species), pet?.breed, pet?.age_years != null ? `${pet.age_years} yaş` : null, pet?.sex]
      .filter(Boolean)
      .join(' · ')
  }

  const actionable =
    selected && (selected.status === 'pending_verification' || selected.status === 'needs_info')

  const ownerShort = selected?.pet_owner_subject?.includes('@')
    ? selected.pet_owner_subject.split('@')[0]
    : selected?.pet_owner_subject || '—'

  const filterTabs = [
    { id: 'all' as const, label: 'Tümü', n: counts.all },
    { id: 'action' as const, label: 'Onay bekleyen', n: counts.action },
    { id: 'waiting' as const, label: 'Eksik bilgi', n: counts.waiting },
    { id: 'done' as const, label: 'Tamamlanan', n: counts.done },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900">Sahip Başvuruları</h1>
        <div className="relative w-full sm:max-w-xs">
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
        {filterTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
              tab === t.id
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-slate-600 hover:text-navy-800'
            }`}
          >
            {t.label}
            <span className="tabular-nums text-slate-400">{t.n}</span>
          </button>
        ))}
      </div>

      <div
        className={`grid gap-4 ${
          detailOpen ? 'xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]' : 'grid-cols-1'
        }`}
      >
        {/* List — full width when detail closed */}
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-soft">
          {loading ? (
            <p className="flex items-center gap-2 px-4 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> Yükleniyor…
            </p>
          ) : visible.length === 0 ? (
            <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title="Kayıt yok" />
          ) : (
            <ul className={`max-h-[min(72vh,42rem)] overflow-y-auto ${detailOpen ? '' : 'sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:max-h-none'}`}>
              {visible.map((s) => {
                const active = detailOpen && s.submission_id === selected?.submission_id
                const name = displayName(s)
                const pet = petById.get(s.pet_id)
                return (
                  <li key={s.submission_id} className="border-b border-slate-100 last:border-0 sm:border-r sm:last:border-b">
                    <button
                      type="button"
                      onClick={() => onSelect(s.submission_id)}
                      className={`flex w-full items-center gap-3 border-l-[3px] px-3 py-3 text-left transition ${
                        STATUS_ACCENT[s.status] || STATUS_ACCENT.draft
                      } ${active ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/90'}`}
                    >
                      <PetAvatar name={name} species={pet?.species} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-navy-900">{name}</p>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                              STATUS_PILL[s.status] || STATUS_PILL.draft
                            }`}
                          >
                            {STATUS_LABEL[s.status] || s.status}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{metaLine(s) || '—'}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                          {s.dicom_ingest_id ? (
                            <span className="inline-flex items-center gap-0.5 text-teal-700">
                              <FileImage className="h-3 w-3" /> DICOM
                            </span>
                          ) : null}
                          <span>{fmtDate(s.updated_at || s.created_at)}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Detail — closable */}
        {detailOpen && selected && (
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-soft">
            <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
              <PetAvatar name={displayName(selected)} species={selectedPet?.species || detail?.species} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold text-navy-900">{displayName(selected)}</h2>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      STATUS_PILL[selected.status] || STATUS_PILL.draft
                    }`}
                  >
                    {STATUS_LABEL[selected.status] || selected.status}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{metaLine(selected)}</p>
                <p className="mt-0.5 text-xs text-slate-400">{fmtDate(selected.created_at)}</p>
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

            <div className="flex gap-0.5 overflow-x-auto border-b border-slate-100 px-2">
              {(
                [
                  { id: 'genel' as const, label: 'Genel' },
                  { id: 'dicom' as const, label: selected.dicom_ingest_id ? 'DICOM' : 'DICOM' },
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
                </button>
              ))}
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              {detailTab === 'genel' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-150 bg-slate-50/80 p-3.5">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sahip</p>
                      <div className="space-y-2">
                        <Field label="Ad" value={ownerShort} />
                        <Field label="E-posta" value={selected.pet_owner_subject || '—'} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-150 bg-slate-50/80 p-3.5">
                      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Ad" value={selectedPet?.name || displayName(selected)} />
                        <Field label="Tür" value={speciesTr(selectedPet?.species || detail?.species)} />
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
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">DICOM</p>
                        <button
                          type="button"
                          className="text-xs font-medium text-teal-700 hover:underline"
                          onClick={() => setDetailTab('dicom')}
                        >
                          Detay
                        </button>
                      </div>
                      {detailLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
                      ) : detailFrames.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {detailFrames.slice(0, 5).map((f) => (
                            <div
                              key={f.sopInstanceUid || f.fileName}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-navy-950"
                            >
                              {f.thumbUrl ? (
                                <img src={f.thumbUrl} alt="" className="h-16 w-16 object-contain" />
                              ) : (
                                <div className="flex h-16 w-16 items-center justify-center text-[10px] text-slate-400">
                                  DCM
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">{detailError || 'Önizleme yok'}</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {detailTab === 'dicom' && (
                <div className="space-y-3">
                  {!selected.dicom_ingest_id ? (
                    <p className="text-sm text-slate-500">DICOM yok</p>
                  ) : detailLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
                  ) : detailError ? (
                    <p className="text-sm text-rose-700">{detailError}</p>
                  ) : (
                    <>
                      {detail?.classification && (
                        <p className="text-sm text-slate-600">
                          {detail.classification.suggested_modality} ·{' '}
                          {detail.classification.suggested_anatomical_region}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {detailFrames.map((f) => (
                          <div
                            key={f.sopInstanceUid || f.fileName}
                            className="overflow-hidden rounded-lg border border-slate-200 bg-navy-950"
                          >
                            {f.thumbUrl ? (
                              <img src={f.thumbUrl} alt="" className="h-24 w-24 object-contain" />
                            ) : (
                              <div className="flex h-24 w-24 items-center justify-center text-xs text-slate-400">
                                {f.modality || 'DCM'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
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

              <div className="border-t border-slate-100 pt-4">
                {actionable ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy === selected.submission_id}
                        onClick={() => onAccept(selected.submission_id)}
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
          </div>
        )}
      </div>
    </div>
  )
}
