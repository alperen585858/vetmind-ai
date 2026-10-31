import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import { createManagedUser, listManagedUsers, updateManagedUser } from '../lib/backend'
import type { BackendManagedUser } from '../types'

export default function AdminUsers() {
  const { t } = useLocale()
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
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.loadUsersFail')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(e instanceof Error ? e.message : t('admin.createFail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('admin.usersTitle')}
        subtitle={t('admin.usersSubtitle')}
        crumbs={[{ label: t('admin.crumbSystem'), to: '/' }, { label: t('admin.crumbUsers') }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-1">
          <CardHeader title={t('admin.newUser')} icon={<ShieldCheck className="h-5 w-5" />} />
          <div className="space-y-3">
            <label className="label">
              {t('common.email')}
              <input className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="label">
              {t('common.password')}
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="label">
              {t('admin.role')}
              <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="vet">vet</option>
                <option value="expert">expert</option>
                <option value="owner">owner</option>
                <option value="clinic_owner">clinic_owner</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="label">
              {t('admin.clinicId')}
              <input className="input mt-1" value={clinic} onChange={(e) => setClinic(e.target.value)} disabled={role === 'admin'} />
            </label>
            <Button onClick={() => void onCreate()} disabled={saving || !email.includes('@')}>
              {saving ? t('admin.saving') : t('admin.create')}
            </Button>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={t('admin.directory')} subtitle={t('admin.userCount', { count: users.length })} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : users.length === 0 ? (
            <EmptyState compact icon={<ShieldCheck className="h-5 w-5" />} title={t('admin.noUsers')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="th">{t('common.email')}</th>
                    <th className="th">{t('admin.role')}</th>
                    <th className="th">{t('admin.clinicId')}</th>
                    <th className="th">{t('common.status')}</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.email}>
                      <td className="td text-sm">{u.email}</td>
                      <td className="td text-xs font-mono">{u.role}</td>
                      <td className="td text-xs">{u.clinic_id || t('common.dash')}</td>
                      <td className="td text-xs">{u.active ? t('admin.activeStaff') : t('admin.inactiveStaff')}</td>
                      <td className="td">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void updateManagedUser(u.email, { active: !u.active }).then(load)
                          }
                        >
                          {u.active ? t('admin.deactivate') : t('admin.activate')}
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
