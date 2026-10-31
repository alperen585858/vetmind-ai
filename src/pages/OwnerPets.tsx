import { useEffect, useState } from 'react'
import { LocalizedLink } from '../components/LocalizedLink'
import { Loader2, PawPrint, Plus } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { createPet, getPetMedicalHistory, listPets, type PetHistoryEntry } from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { BackendPet } from '../types'

export default function OwnerPets() {
  const { t, locale } = useLocale()
  const [pets, setPets] = useState<BackendPet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<'canine' | 'feline' | 'other'>('canine')
  const [breed, setBreed] = useState('')
  const [age, setAge] = useState('')
  const [history, setHistory] = useState('')
  const [saving, setSaving] = useState(false)
  const [historyPetId, setHistoryPetId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<PetHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = () => {
    setLoading(true)
    void listPets()
      .then(setPets)
      .catch((e) => setError(e instanceof Error ? e.message : t('pets.loadFailed')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const openHistory = async (petId: string) => {
    if (historyPetId === petId) {
      setHistoryPetId(null)
      setTimeline([])
      return
    }
    setHistoryPetId(petId)
    setHistoryLoading(true)
    try {
      const h = await getPetMedicalHistory(petId)
      setTimeline(h.timeline)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pets.historyLoadFailed'))
      setTimeline([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const onCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createPet({
        name: name.trim(),
        species,
        breed: breed || undefined,
        age_years: age ? Number(age) : undefined,
        medical_history: history || undefined,
      })
      setName('')
      setBreed('')
      setAge('')
      setHistory('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pets.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('pets.profilesTitle')}
        subtitle={t('pets.subtitle')}
        crumbs={[{ label: t('pets.crumbPanel'), to: '/' }, { label: t('pets.crumbPets') }]}
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            {t('common.refresh')}
          </Button>
        }
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title={t('pets.newPet')} icon={<Plus className="h-5 w-5" />} />
          <div className="space-y-3 px-1 pb-2">
            <label className="label">
              {t('pets.nameRequired')}
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="label">
              {t('cases.species')}
              <select
                className="input mt-1"
                value={species}
                onChange={(e) => setSpecies(e.target.value as 'canine' | 'feline' | 'other')}
              >
                <option value="canine">{t('pets.speciesCanine')}</option>
                <option value="feline">{t('pets.speciesFeline')}</option>
                <option value="other">{t('pets.speciesOther')}</option>
              </select>
            </label>
            <label className="label">
              {t('pets.breed')}
              <input className="input mt-1" value={breed} onChange={(e) => setBreed(e.target.value)} />
            </label>
            <label className="label">
              {t('pets.ageYears')}
              <input className="input mt-1" type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} />
            </label>
            <label className="label">
              {t('pets.medicalHistory')}
              <textarea className="input mt-1 min-h-[80px]" value={history} onChange={(e) => setHistory(e.target.value)} />
            </label>
            <Button onClick={() => void onCreate()} disabled={saving || !name.trim()}>
              {saving ? t('pets.saving') : t('pets.savePet')}
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title={t('pets.registeredPets')} subtitle={t('pets.profileCount', { count: pets.length })} icon={<PawPrint className="h-5 w-5" />} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : pets.length === 0 ? (
            <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title={t('pets.emptyTitle')} text={t('pets.emptyHint')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {pets.map((p) => (
                <li key={p.pet_id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-navy-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.species} · {p.breed || t('common.dash')} ·{' '}
                        {p.age_years != null ? t('pets.ageDisplay', { age: p.age_years }) : t('pets.noAge')}
                      </p>
                      {p.medical_history && <p className="mt-1 text-xs text-slate-600 line-clamp-2">{p.medical_history}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        className="text-xs font-semibold text-navy-800 hover:underline"
                        onClick={() => void openHistory(p.pet_id)}
                      >
                        {historyPetId === p.pet_id ? t('pets.closeHistory') : t('pets.openHistory')}
                      </button>
                      <LocalizedLink to="/basvurular" className="text-xs font-semibold text-sky-700 hover:underline">
                        {t('pets.createRequest')}
                      </LocalizedLink>
                    </div>
                  </div>
                  {historyPetId === p.pet_id && (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                      {historyLoading ? (
                        <p className="flex items-center gap-2 text-xs text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
                        </p>
                      ) : timeline.length === 0 ? (
                        <p className="text-xs text-slate-500">{t('pets.noTimeline')}</p>
                      ) : (
                        <ul className="space-y-2">
                          {timeline.map((e, i) => (
                            <li key={`${e.kind}-${e.at}-${i}`} className="text-xs">
                              <p className="font-medium text-navy-900">
                                {e.title}{' '}
                                <span className="font-normal text-slate-400">· {fmtDate(e.at, locale)}</span>
                              </p>
                              {e.detail && <p className="text-slate-600 line-clamp-2">{e.detail}</p>}
                              {e.link_path && (
                                <LocalizedLink to={e.link_path} className="font-medium text-sky-700 hover:underline">
                                  {t('cases.open')}
                                </LocalizedLink>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
