import { useEffect, useMemo, useState } from 'react'
import { Link2, Search, UserRound, X } from 'lucide-react'
import { useLocale } from '../../shared/shell/LocaleContext'
import { searchPatients, toBackendSpecies } from '../../shared/api'
import type { BackendPatient, Species } from '../../shared/types'
import { fromBackendSpecies, namesakes } from './patientLib'

const SEARCH_DELAY_MS = 250

/**
 * New-case wizard (issue #108): pick an existing clinic patient so the study joins the
 * animal's history, or leave it empty and a new patient record is created on submit.
 * Typing a name that already exists shows it as a suggestion; nothing is linked silently.
 */
export function PatientPicker({
  selected,
  onSelect,
  typedName,
  typedSpecies,
}: {
  selected: BackendPatient | null
  onSelect: (patient: BackendPatient | null) => void
  typedName: string
  typedSpecies: Species
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BackendPatient[]>([])
  const [recent, setRecent] = useState<BackendPatient[]>([])
  const [available, setAvailable] = useState(true)

  // Recent patients double as the source for name suggestions.
  useEffect(() => {
    const ctrl = new AbortController()
    searchPatients('', { signal: ctrl.signal })
      .then(setRecent)
      .catch(() => {
        if (!ctrl.signal.aborted) setAvailable(false)
      })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      searchPatients(q, { signal: ctrl.signal })
        .then(setResults)
        .catch(() => {
          /* offline: keep previous results */
        })
    }, SEARCH_DELAY_MS)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [query])

  const suggestions = useMemo(
    () => (selected ? [] : namesakes(recent, typedName, toBackendSpecies(typedSpecies))),
    [recent, typedName, typedSpecies, selected],
  )

  if (!available) return null

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3" role="status">
        <Link2 className="h-4 w-4 text-teal-700" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-navy-900">
            {t('patients.linkedTo', { name: selected.name })}
            <span className="ml-1 font-normal text-slate-600">
              · {fromBackendSpecies(selected.species)}
              {selected.breed ? ` · ${selected.breed}` : ''}
            </span>
          </p>
          {(selected.microchip || selected.clinic_patient_no) && (
            <p className="text-xs text-slate-600">
              {selected.microchip ? `${t('patients.microchip')}: ${selected.microchip}` : ''}
              {selected.microchip && selected.clinic_patient_no ? ' · ' : ''}
              {selected.clinic_patient_no ? `${t('patients.clinicNo')}: ${selected.clinic_patient_no}` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline"
          onClick={() => onSelect(null)}
        >
          <X className="h-3.5 w-3.5" /> {t('patients.unlink')}
        </button>
      </div>
    )
  }

  const list = query.trim() ? results : []
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <label className="block">
        <span className="label">{t('patients.searchLabel')}</span>
        <span className="relative mt-1 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('patients.searchPlaceholder')}
            maxLength={120}
          />
        </span>
      </label>
      <p className="mt-2 text-xs text-slate-500">{t('patients.searchHint')}</p>

      {suggestions.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-medium">{t('patients.namesakeTitle')}</p>
          <PatientRows patients={suggestions} onPick={onSelect} />
        </div>
      )}

      {query.trim() && list.length === 0 && <p className="mt-3 text-sm text-slate-500">{t('patients.noResults')}</p>}
      {list.length > 0 && <PatientRows patients={list} onPick={onSelect} />}
    </div>
  )
}

function PatientRows({ patients, onPick }: { patients: BackendPatient[]; onPick: (p: BackendPatient) => void }) {
  const { t } = useLocale()
  return (
    <ul className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {patients.map((p) => (
        <li key={p.patient_id} className="flex items-center gap-3 px-3 py-2">
          <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium text-navy-900">
              {p.name}{' '}
              <span className="font-normal text-slate-500">
                · {fromBackendSpecies(p.species)}
                {p.breed ? ` · ${p.breed}` : ''}
              </span>
            </p>
            {(p.microchip || p.clinic_patient_no) && (
              <p className="truncate text-xs text-slate-500">{p.microchip || p.clinic_patient_no}</p>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700"
            onClick={() => onPick(p)}
            aria-label={t('patients.pickAria', { name: p.name })}
          >
            {t('patients.pick')}
          </button>
        </li>
      ))}
    </ul>
  )
}
