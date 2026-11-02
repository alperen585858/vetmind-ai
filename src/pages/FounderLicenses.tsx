import { useEffect, useMemo, useState } from 'react'
import { Building2, Loader2, PawPrint, Plus, Stethoscope, UserCog } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import {
  createClinicStaff,
  createLicensedClinic,
  listClinicStaff,
  listLicensedClinics,
  listLicenseOwners,
  updateClinicStaff,
  updateLicensedClinic,
  updateLicenseOwner,
} from '../lib/backend'
import type {
  BackendClinicStaffRole,
  BackendClinicStaffSummary,
  BackendLicensedClinicSummary,
  BackendOwnerAccountSummary,
} from '../types'

type Tab = 'staff' | 'clinics' | 'owners'

export default function FounderLicenses() {
  const { t } = useLocale()
  const [tab, setTab] = useState<Tab>('staff')
  const [clinics, setClinics] = useState<BackendLicensedClinicSummary[]>([])
  const [staff, setStaff] = useState<BackendClinicStaffSummary[]>([])
  const [owners, setOwners] = useState<BackendOwnerAccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Clinic create
  const [name, setName] = useState('')
  const [clinicId, setClinicId] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('demo1234')
  const [savingClinic, setSavingClinic] = useState(false)

  // Staff create
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('demo1234')
  const [staffRole, setStaffRole] = useState<BackendClinicStaffRole>('vet')
  const [staffClinicId, setStaffClinicId] = useState('')
  const [staffName, setStaffName] = useState('')
  const [savingStaff, setSavingStaff] = useState(false)
  const [staffFilterClinic, setStaffFilterClinic] = useState('')

  const activeClinics = useMemo(
    () => clinics.filter((c) => c.status === 'active'),
    [clinics],
  )

  const filteredStaff = useMemo(() => {
    if (!staffFilterClinic) return staff
    return staff.filter((s) => s.clinic_id === staffFilterClinic)
  }, [staff, staffFilterClinic])

  const load = async () => {
    setLoading(true)
    try {
      const [c, s, o] = await Promise.all([
        listLicensedClinics(),
        listClinicStaff(),
        listLicenseOwners(),
      ])
      setClinics(c)
      setStaff(s)
      setOwners(o)
      if (!staffClinicId && c.length > 0) {
        const preferred = c.find((x) => x.status === 'active') ?? c[0]
        setStaffClinicId(preferred.clinic_id)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.loadFail'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCreateClinic = async () => {
    if (name.trim().length < 2) return
    setSavingClinic(true)
    setError(null)
    try {
      await createLicensedClinic({
        name: name.trim(),
        clinic_id: clinicId.trim() || undefined,
        clinic_owner_email: ownerEmail.trim() || undefined,
        clinic_owner_password: ownerEmail.trim() ? ownerPassword : undefined,
      })
      setName('')
      setClinicId('')
      setOwnerEmail('')
      setOwnerPassword('demo1234')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.createFail'))
    } finally {
      setSavingClinic(false)
    }
  }

  const onCreateStaff = async () => {
    if (!staffEmail.includes('@') || !staffClinicId) return
    setSavingStaff(true)
    setError(null)
    try {
      await createClinicStaff({
        email: staffEmail.trim().toLowerCase(),
        password: staffPassword,
        role: staffRole,
        clinic_id: staffClinicId,
        display_name: staffName.trim() || undefined,
      })
      setStaffEmail('')
      setStaffPassword('demo1234')
      setStaffName('')
      setStaffRole('vet')
      await load()
      setTab('staff')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.staffCreateFail'))
    } finally {
      setSavingStaff(false)
    }
  }

  const onToggleClinic = async (row: BackendLicensedClinicSummary) => {
    const next = row.status === 'active' ? 'inactive' : 'active'
    setBusyId(row.clinic_id)
    setError(null)
    try {
      await updateLicensedClinic(row.clinic_id, { status: next })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.updateFail'))
    } finally {
      setBusyId(null)
    }
  }

  const onToggleStaff = async (row: BackendClinicStaffSummary) => {
    setBusyId(row.email)
    setError(null)
    try {
      await updateClinicStaff(row.email, { active: !row.active })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.updateFail'))
    } finally {
      setBusyId(null)
    }
  }

  const onToggleOwner = async (row: BackendOwnerAccountSummary) => {
    setBusyId(row.email)
    setError(null)
    try {
      await updateLicenseOwner(row.email, !row.active)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.updateFail'))
    } finally {
      setBusyId(null)
    }
  }

  const statusLabel = (status: string) => {
    if (status === 'active') return t('founder.statusActive')
    if (status === 'inactive') return t('founder.statusInactive')
    return t('founder.statusPending')
  }

  const roleLabel = (role: BackendClinicStaffRole) =>
    role === 'vet' ? t('founder.roleVet') : t('founder.roleClinicAdmin')

  return (
    <>
      <PageHeader
        title={t('founder.title')}
        subtitle={t('founder.subtitle')}
        crumbs={[{ label: t('admin.crumbSystem'), to: '/' }, { label: t('nav.licenses') }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant={tab === 'staff' ? 'primary' : 'secondary'} onClick={() => setTab('staff')}>
          <Stethoscope className="h-4 w-4" /> {t('founder.tabStaff')}
        </Button>
        <Button variant={tab === 'clinics' ? 'primary' : 'secondary'} onClick={() => setTab('clinics')}>
          <Building2 className="h-4 w-4" /> {t('founder.tabClinics')}
        </Button>
        <Button variant={tab === 'owners' ? 'primary' : 'secondary'} onClick={() => setTab('owners')}>
          <PawPrint className="h-4 w-4" /> {t('founder.tabOwners')}
        </Button>
      </div>

      {tab === 'staff' ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-1">
            <CardHeader title={t('founder.newStaff')} icon={<Plus className="h-5 w-5" />} />
            <div className="space-y-3">
              <label className="label">
                {t('founder.staffRole')}
                <select
                  className="input mt-1"
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as BackendClinicStaffRole)}
                >
                  <option value="vet">{t('founder.roleVet')}</option>
                  <option value="clinic_owner">{t('founder.roleClinicAdmin')}</option>
                </select>
              </label>
              <label className="label">
                {t('admin.clinicId')}
                <select
                  className="input mt-1"
                  value={staffClinicId}
                  onChange={(e) => setStaffClinicId(e.target.value)}
                >
                  {activeClinics.length === 0 ? (
                    <option value="">{t('founder.noActiveClinic')}</option>
                  ) : (
                    activeClinics.map((c) => (
                      <option key={c.clinic_id} value={c.clinic_id}>
                        {c.name} ({c.clinic_id})
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="label">
                {t('common.email')}
                <input
                  className="input mt-1"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                />
              </label>
              <label className="label">
                {t('common.name')}
                <input
                  className="input mt-1"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder={t('common.optional')}
                />
              </label>
              <label className="label">
                {t('common.password')}
                <input
                  className="input mt-1"
                  type="password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                />
              </label>
              <Button
                onClick={() => void onCreateStaff()}
                disabled={savingStaff || !staffEmail.includes('@') || !staffClinicId}
              >
                {savingStaff ? t('admin.saving') : t('founder.createStaff')}
              </Button>
              <p className="text-xs text-slate-500">{t('founder.staffHint')}</p>
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title={t('founder.staffTitle')}
              subtitle={t('founder.staffCount', { count: filteredStaff.length })}
              action={
                <select
                  className="input max-w-[220px] text-sm"
                  value={staffFilterClinic}
                  onChange={(e) => setStaffFilterClinic(e.target.value)}
                >
                  <option value="">{t('founder.allClinics')}</option>
                  {clinics.map((c) => (
                    <option key={c.clinic_id} value={c.clinic_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              }
            />
            {loading ? (
              <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </p>
            ) : filteredStaff.length === 0 ? (
              <EmptyState compact icon={<UserCog className="h-5 w-5" />} title={t('founder.noStaff')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className="th">{t('common.email')}</th>
                      <th className="th">{t('common.name')}</th>
                      <th className="th">{t('founder.staffRole')}</th>
                      <th className="th">{t('founder.clinic')}</th>
                      <th className="th">{t('common.cases')}</th>
                      <th className="th">{t('common.status')}</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStaff.map((s) => (
                      <tr key={s.email}>
                        <td className="td text-sm">{s.email}</td>
                        <td className="td text-sm">{s.display_name || t('common.dash')}</td>
                        <td className="td text-sm">{roleLabel(s.role)}</td>
                        <td className="td text-xs">
                          <div className="font-medium text-navy-900">{s.clinic_name || t('common.dash')}</div>
                          <div className="font-mono text-slate-500">{s.clinic_id || ''}</div>
                        </td>
                        <td className="td text-sm">{s.case_count}</td>
                        <td className="td text-sm">
                          {s.active ? t('founder.statusActive') : t('founder.statusInactive')}
                        </td>
                        <td className="td text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === s.email}
                            onClick={() => void onToggleStaff(s)}
                          >
                            {s.active ? t('founder.deactivate') : t('founder.activate')}
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
      ) : null}

      {tab === 'clinics' ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-1">
            <CardHeader title={t('founder.newClinic')} icon={<Plus className="h-5 w-5" />} />
            <div className="space-y-3">
              <label className="label">
                {t('common.name')}
                <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="label">
                {t('founder.clinicIdOptional')}
                <input
                  className="input mt-1 font-mono text-sm"
                  value={clinicId}
                  onChange={(e) => setClinicId(e.target.value)}
                  placeholder="clinic-…"
                />
              </label>
              <label className="label">
                {t('founder.ownerEmailOptional')}
                <input className="input mt-1" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
              </label>
              {ownerEmail.trim() ? (
                <label className="label">
                  {t('common.password')}
                  <input
                    className="input mt-1"
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                  />
                </label>
              ) : null}
              <Button onClick={() => void onCreateClinic()} disabled={savingClinic || name.trim().length < 2}>
                {savingClinic ? t('admin.saving') : t('founder.createClinic')}
              </Button>
              <p className="text-xs text-slate-500">{t('founder.clinicHint')}</p>
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title={t('founder.clinicsTitle')}
              subtitle={t('founder.clinicCount', { count: clinics.length })}
            />
            {loading ? (
              <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </p>
            ) : clinics.length === 0 ? (
              <EmptyState compact icon={<Building2 className="h-5 w-5" />} title={t('founder.noClinics')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className="th">{t('common.name')}</th>
                      <th className="th">{t('admin.clinicId')}</th>
                      <th className="th">{t('common.status')}</th>
                      <th className="th">{t('founder.roleVet')}</th>
                      <th className="th">{t('founder.roleClinicAdmin')}</th>
                      <th className="th">{t('common.cases')}</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clinics.map((c) => (
                      <tr key={c.clinic_id}>
                        <td className="td text-sm font-medium text-navy-900">{c.name}</td>
                        <td className="td font-mono text-xs text-slate-600">{c.clinic_id}</td>
                        <td className="td text-sm">{statusLabel(c.status)}</td>
                        <td className="td text-sm">{c.vet_count}</td>
                        <td className="td text-sm">{c.clinic_owner_count}</td>
                        <td className="td text-sm">{c.case_count}</td>
                        <td className="td text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === c.clinic_id}
                            onClick={() => void onToggleClinic(c)}
                          >
                            {c.status === 'active' ? t('founder.deactivate') : t('founder.activate')}
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
      ) : null}

      {tab === 'owners' ? (
        <Card>
          <CardHeader title={t('founder.ownersTitle')} subtitle={t('founder.ownerCount', { count: owners.length })} />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : owners.length === 0 ? (
            <EmptyState compact icon={<PawPrint className="h-5 w-5" />} title={t('founder.noOwners')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="th">{t('common.email')}</th>
                    <th className="th">{t('common.name')}</th>
                    <th className="th">{t('admin.clinicId')}</th>
                    <th className="th">{t('founder.pets')}</th>
                    <th className="th">{t('founder.submissions')}</th>
                    <th className="th">{t('common.cases')}</th>
                    <th className="th">{t('common.status')}</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {owners.map((o) => (
                    <tr key={o.email}>
                      <td className="td text-sm">{o.email}</td>
                      <td className="td text-sm">{o.display_name || t('common.dash')}</td>
                      <td className="td font-mono text-xs">{o.clinic_id || t('common.dash')}</td>
                      <td className="td text-sm">{o.pet_count}</td>
                      <td className="td text-sm">{o.submission_count}</td>
                      <td className="td text-sm">{o.case_count}</td>
                      <td className="td text-sm">
                        {o.active ? t('founder.statusActive') : t('founder.statusInactive')}
                      </td>
                      <td className="td text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === o.email}
                          onClick={() => void onToggleOwner(o)}
                        >
                          {o.active ? t('founder.deactivate') : t('founder.activate')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  )
}
