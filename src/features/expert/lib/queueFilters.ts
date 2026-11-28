import type { VetCase } from '../../../shared/types'

/** Worklist tab, kept in the URL so a link opens the same view (?acil=1, ?sla=az, ?bana=1). */
export type QueueView = 'all' | 'urgent' | 'sla' | 'mine'

/** Free-text search over the fields a radiologist types: patient, case no, clinic, breed, study. */
export function matchesSearch(c: VetCase, needle: string): boolean {
  if (!needle) return true
  return [c.patient.name, c.no, c.id, c.clinic, c.patient.breed, c.patient.species, c.modality, c.anatomicalRegion]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr')
    .includes(needle)
}

export function viewFromParams(params: URLSearchParams): QueueView {
  if (params.get('sla') === 'az') return 'sla'
  if (params.get('acil') === '1') return 'urgent'
  if (params.get('bana') === '1') return 'mine'
  return 'all'
}
