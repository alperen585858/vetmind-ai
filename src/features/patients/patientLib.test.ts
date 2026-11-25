import { describe, expect, it } from 'vitest'
import type { BackendPatient, Patient } from '../../shared/types'
import { foldName, fromBackendSpecies, monthsBetween, namesakes, patientFormFromRecord, relativeAge, studyDate } from './patientLib'

const rec = (over: Partial<BackendPatient>): BackendPatient => ({
  patient_id: 'pat-1',
  name: 'Paşa',
  species: 'canine',
  dicom_patient_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('patientLib', () => {
  it('folds case and Turkish letters like the backend', () => {
    expect(foldName('  PAŞA  Çığ ')).toBe('pasa cig')
    expect(foldName(undefined)).toBe('')
  })

  it('maps backend species to wizard labels', () => {
    expect(fromBackendSpecies('canine')).toBe('Köpek')
    expect(fromBackendSpecies('feline')).toBe('Kedi')
    expect(fromBackendSpecies('other')).toBe('Diğer')
  })

  it('takes name, species, breed and sex from the record and keeps the rest', () => {
    const current: Patient = { name: 'x', species: 'Köpek', breed: '', sex: 'Erkek', neutered: true, age: 3, weight: 12, ownerName: 'Ali', ownerPhone: '' }
    const next = patientFormFromRecord(current, rec({ name: 'Pamuk', species: 'feline', breed: 'Van', sex: 'Dişi' }))
    expect(next).toMatchObject({ name: 'Pamuk', species: 'Kedi', breed: 'Van', sex: 'Dişi', age: 3, weight: 12, ownerName: 'Ali' })
    expect(patientFormFromRecord(current, rec({ sex: 'bilinmiyor' })).sex).toBe('Erkek')
  })

  it('finds namesakes by folded name and species', () => {
    const list = [rec({ patient_id: 'a' }), rec({ patient_id: 'b', species: 'feline' }), rec({ patient_id: 'c', name: 'Boncuk' })]
    expect(namesakes(list, 'pasa', 'canine').map((p) => p.patient_id)).toEqual(['a'])
    expect(namesakes(list, 'PAŞA').map((p) => p.patient_id)).toEqual(['a', 'b'])
    expect(namesakes(list, 'p')).toEqual([])
  })

  it('reads DICOM study dates and falls back to created_at', () => {
    expect(studyDate({ study_date: '20260803', created_at: '2020-01-01T00:00:00Z' }).toISOString()).toBe('2026-08-03T00:00:00.000Z')
    expect(studyDate({ study_date: null, created_at: '2026-02-01T10:00:00Z' }).toISOString()).toBe('2026-02-01T10:00:00.000Z')
  })

  it('counts whole months and picks a readable unit', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`)
    expect(monthsBetween(d('2026-01-31'), d('2026-04-30'))).toBe(2)
    expect(monthsBetween(d('2026-05-01'), d('2026-01-01'))).toBe(0)
    expect(relativeAge(d('2026-01-01'), d('2026-01-05'))).toEqual({ unit: 'day', value: 4 })
    expect(relativeAge(d('2026-01-01'), d('2026-01-22'))).toEqual({ unit: 'week', value: 3 })
    expect(relativeAge(d('2026-01-01'), d('2026-04-02'))).toEqual({ unit: 'month', value: 3 })
    expect(relativeAge(d('2023-01-01'), d('2026-02-01'))).toEqual({ unit: 'year', value: 3 })
  })
})
