import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, PawPrint, Plus } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { createPet, listPets } from '../lib/backend'
import type { BackendPet } from '../types'

export default function OwnerPets() {
  const [pets, setPets] = useState<BackendPet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<'canine' | 'feline'>('canine')
  const [breed, setBreed] = useState('')
  const [age, setAge] = useState('')
  const [history, setHistory] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    void listPets()
      .then(setPets)
      .catch((e) => setError(e instanceof Error ? e.message : 'Petler yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

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
      setError(e instanceof Error ? e.message : 'Kayıt başarısız')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Pet profilleri"
        subtitle="Tür, ırk, yaş ve tıbbi öykü — görüntüleme taleplerine bağlanır"
        crumbs={[{ label: 'Panel', to: '/' }, { label: 'Petler' }]}
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            Yenile
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
          <CardHeader title="Yeni pet" icon={<Plus className="h-5 w-5" />} />
          <div className="space-y-3 px-1 pb-2">
            <label className="label">
              Ad *
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="label">
              Tür
              <select className="input mt-1" value={species} onChange={(e) => setSpecies(e.target.value as 'canine' | 'feline')}>
                <option value="canine">Köpek</option>
                <option value="feline">Kedi</option>
              </select>
            </label>
            <label className="label">
              Irk
              <input className="input mt-1" value={breed} onChange={(e) => setBreed(e.target.value)} />
            </label>
            <label className="label">
              Yaş (yıl)
              <input className="input mt-1" type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} />
            </label>
            <label className="label">
              Tıbbi öykü
              <textarea className="input mt-1 min-h-[80px]" value={history} onChange={(e) => setHistory(e.target.value)} />
            </label>
            <Button onClick={() => void onCreate()} disabled={saving || !name.trim()}>
              {saving ? 'Kaydediliyor…' : 'Pet kaydet'}
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Kayıtlı petler" subtitle={`${pets.length} profil`} icon={<PawPrint className="h-5 w-5" />} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </p>
          ) : pets.length === 0 ? (
            <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title="Henüz pet yok" text="Önce bir pet profili oluşturun." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {pets.map((p) => (
                <li key={p.pet_id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-semibold text-navy-900">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.species} · {p.breed || '—'} · {p.age_years != null ? `${p.age_years} yaş` : 'yaş yok'}
                    </p>
                    {p.medical_history && <p className="mt-1 text-xs text-slate-600 line-clamp-2">{p.medical_history}</p>}
                  </div>
                  <Link to="/basvurular" className="text-xs font-semibold text-teal-700 hover:underline">
                    Talep oluştur
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
