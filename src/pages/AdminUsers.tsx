import { useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import { createManagedUser, createPasswordResetLink, listManagedUsers, updateManagedUser } from '../lib/backend'
import type { BackendManagedUser } from '../types'

/** Active accounts in these roles must belong to a clinic (the backend enforces it). */
const CLINIC_REQUIRED_ROLES = new Set(['vet', 'expert', 'clinic_owner'])
const DEFAULT_CLINIC = 'clinic-demo-a'

function needsClinicToActivate(u: BackendManagedUser): boolean {
  return !u.active && CLINIC_REQUIRED_ROLES.has(u.role) && !u.clinic_id
}

export default function AdminUsers() {
  const { t } = useLocale()
  const [users, setUsers] = useState<BackendManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('demo1234')
  const [role, setRole] = useState('vet')
  const [clinic, setClinic] = useState(DEFAULT_CLINIC)
  const [saving, setSaving] = useState(false)
  // Clinic typed per pending row (self-registered vets have none until an admin assigns it).
  const [activationClinic, setActivationClinic] = useState<Record<string, string>>({})
  const [updating, setUpdating] = useState<string | null>(null)
  const [resetLink, setResetLink] = useState<{ email: string; link: string; minutes: number } | null>(null)
  const [copied, setCopied] = useState(false)

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

  const onToggleActive = async (u: BackendManagedUser) => {
    setUpdating(u.email)
    setError(null)
    try {
      if (needsClinicToActivate(u)) {
        const clinicId = (activationClinic[u.email] ?? DEFAULT_CLINIC).trim()
        await updateManagedUser(u.email, { active: true, clinic_id: clinicId })
      } else {
        await updateManagedUser(u.email, { active: !u.active })
      }
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.updateFail'))
    } finally {
      setUpdating(null)
    }
  }

  const onResetLink = async (u: BackendManagedUser) => {
    setUpdating(u.email)
    setError(null)
    setCopied(false)
    try {
      const res = await createPasswordResetLink(u.email)
      setResetLink({ email: res.email, link: res.link, minutes: Math.round(res.expires_in / 60) })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.updateFail'))
    } finally {
      setUpdating(null)
    }
  }

  const onCopy = async () => {
    if (!resetLink) return
    try {
      await navigator.clipboard.writeText(resetLink.link)
      setCopied(true)
    } catch {
      setCopied(false)
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
      {resetLink && (
        <div role="status" className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-navy-800">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{t('admin.resetLinkTitle', { email: resetLink.email })}</p>
            <button
              type="button"
              aria-label={t('admin.close')}
              className="text-navy-500 hover:text-navy-800"
              onClick={() => setResetLink(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              aria-label={t('admin.resetLink')}
              className="input h-8 min-w-0 flex-1 font-mono text-xs"
              value={resetLink.link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void onCopy()}>
              {copied ? t('admin.copied') : t('admin.copyLink')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-navy-600">{t('admin.resetLinkHint', { minutes: resetLink.minutes })}</p>
        </div>
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
                      <td className="td text-xs">
                        {needsClinicToActivate(u) ? (
                          <input
                            className="input h-8 w-36 text-xs"
                            aria-label={`${t('admin.clinicToActivate')}: ${u.email}`}
                            placeholder={DEFAULT_CLINIC}
                            value={activationClinic[u.email] ?? DEFAULT_CLINIC}
                            onChange={(e) =>
                              setActivationClinic((prev) => ({ ...prev, [u.email]: e.target.value }))
                            }
                          />
                        ) : (
                          u.clinic_id || t('common.dash')
                        )}
                      </td>
                      <td className="td text-xs">
                        {needsClinicToActivate(u) ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                            {t('admin.pendingApproval')}
                          </span>
                        ) : u.active ? (
                          t('admin.activeStaff')
                        ) : (
                          t('admin.inactiveStaff')
                        )}
                      </td>
                      <td className="td">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            updating === u.email ||
                            (needsClinicToActivate(u) && !(activationClinic[u.email] ?? DEFAULT_CLINIC).trim())
                          }
                          onClick={() => void onToggleActive(u)}
                        >
                          {u.active ? t('admin.deactivate') : t('admin.activate')}
                        </Button>
                        {u.active && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-2"
                            icon={<KeyRound className="h-3.5 w-3.5" />}
                            disabled={updating === u.email}
                            onClick={() => void onResetLink(u)}
                          >
                            {t('admin.resetLink')}
                          </Button>
                        )}
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
