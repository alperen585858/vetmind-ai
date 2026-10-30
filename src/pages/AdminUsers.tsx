import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { createManagedUser, listManagedUsers, updateManagedUser } from '../lib/backend'
import type { BackendManagedUser } from '../types'

export default function AdminUsers() {
  const [users, setUsers] = useState<BackendManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('demo1234')
  const [role, setRole] = useState('vet')
  const [clinic, setClinic] = useState('clinic-demo-a')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    void listManagedUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Kullanıcılar yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const onCreate = async () => {
    setSaving(true)
    setError(null)
    try {
      await createManagedUser({
        email,
        password,
        role,
        clinic_id: role === 'admin' ? undefined : clinic,
        display_name: email.split('@')[0],
      })
      setEmail('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Oluşturulamadı')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Kullanıcılar ve roller"
        subtitle="Klinik üyelikleri · demo IdP dizini (kalıcı workflow store). Self-serve /kayit yalnızca tarayıcı hesabıdır; API RBAC için burada kullanıcı oluşturun."
        crumbs={[{ label: 'Sistem', to: '/' }, { label: 'Kullanıcılar' }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-1">
          <CardHeader title="Yeni kullanıcı" icon={<ShieldCheck className="h-5 w-5" />} />
          <div className="space-y-3">
            <label className="label">
              E-posta
              <input className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="label">
              Şifre
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="label">
              Rol
              <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="vet">vet</option>
                <option value="expert">expert</option>
                <option value="owner">owner</option>
                <option value="clinic_owner">clinic_owner</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="label">
              Klinik ID
              <input className="input mt-1" value={clinic} onChange={(e) => setClinic(e.target.value)} disabled={role === 'admin'} />
            </label>
            <Button onClick={() => void onCreate()} disabled={saving || !email.includes('@')}>
              {saving ? 'Kaydediliyor…' : 'Oluştur'}
            </Button>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Dizin" subtitle={`${users.length} kullanıcı`} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </p>
          ) : users.length === 0 ? (
            <EmptyState compact icon={<ShieldCheck className="h-5 w-5" />} title="Kullanıcı yok" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="th">E-posta</th>
                    <th className="th">Rol</th>
                    <th className="th">Klinik</th>
                    <th className="th">Durum</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.email}>
                      <td className="td text-sm">{u.email}</td>
                      <td className="td text-xs font-mono">{u.role}</td>
                      <td className="td text-xs">{u.clinic_id || '—'}</td>
                      <td className="td text-xs">{u.active ? 'aktif' : 'pasif'}</td>
                      <td className="td">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void updateManagedUser(u.email, { active: !u.active }).then(load)
                          }
                        >
                          {u.active ? 'Pasifleştir' : 'Aktifleştir'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
