import type { BackendPatient, BackendPriorStudy, BackendSpecies, Patient, Species } from '../../shared/types'

const TR_FOLD: Record<string, string> = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' }

/** Case- and accent-insensitive key, same rule as the backend ("Paşa" == "pasa"). */
export function foldName(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (ch) => TR_FOLD[ch] ?? ch)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

export function fromBackendSpecies(species: BackendSpecies): Species {
  if (species === 'canine') return 'Köpek'
  if (species === 'feline') return 'Kedi'
  return 'Diğer'
}

/** Wizard form values taken over from a chosen patient record (other fields kept). */
export function patientFormFromRecord(current: Patient, record: BackendPatient): Patient {
  const sex = record.sex === 'Dişi' || record.sex === 'Erkek' ? record.sex : current.sex
  return {
    ...current,
    name: record.name,
    species: fromBackendSpecies(record.species),
    breed: record.breed ?? '',
    sex,
  }
}

/** Existing patients whose name (and species, when given) match what the vet typed. */
export function namesakes(records: BackendPatient[], name: string, species?: BackendSpecies): BackendPatient[] {
  const key = foldName(name)
  if (key.length < 2) return []
  return records.filter((p) => foldName(p.name) === key && (!species || p.species === species))
}

/** DICOM StudyDate (YYYYMMDD) or ISO timestamp → Date. */
export function studyDate(study: Pick<BackendPriorStudy, 'study_date' | 'created_at'>): Date {
  const raw = study.study_date
  if (raw && /^\d{8}$/.test(raw)) {
    return new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))))
  }
  return new Date(study.created_at)
}

/** Whole months between two dates (never negative), for "3 months earlier" labels. */
export function monthsBetween(earlier: Date, later: Date): number {
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth())
  if (later.getUTCDate() < earlier.getUTCDate()) months -= 1
  return Math.max(0, months)
}

/** Relative age of a prior study: { unit, value } for i18n ("2 hafta önce", "3 ay önce"). */
export function relativeAge(earlier: Date, later: Date): { unit: 'day' | 'week' | 'month' | 'year'; value: number } {
  const days = Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86_400_000))
  if (days < 14) return { unit: 'day', value: days }
  const months = monthsBetween(earlier, later)
  if (months < 1) return { unit: 'week', value: Math.floor(days / 7) }
  if (months < 24) return { unit: 'month', value: months }
  return { unit: 'year', value: Math.floor(months / 12) }
}
