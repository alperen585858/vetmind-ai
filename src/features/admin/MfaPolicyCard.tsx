import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Card, CardHeader } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useApp } from '../../shared/shell/AppContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { getMfaPolicy, updateMfaPolicy, type MfaPolicy } from '../../shared/api'

export function sameRoles(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
}

/**
 * Issue #107 — Admin → Users: which roles must use two-step sign-in. Users of a chosen role
 * are asked to set it up at their next sign-in. Demo accounts (*@demo.local) are always exempt.
 */
export function MfaPolicyCard() {
  const { t } = useLocale()
  const { authMode, pushToast } = useApp()
  const [policy, setPolicy] = useState<MfaPolicy | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getMfaPolicy()
      .then((p) => {
        setPolicy(p)
        setSelected(p.required_roles)
      })
      .catch(() => setFailed(true))
  }, [])

  if (failed) return null

  const toggle = (role: string) =>
    setSelected((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]))

  const save = async () => {
    setSaving(true)
    try {
      const next = await updateMfaPolicy(selected)
      setPolicy(next)
      setSelected(next.required_roles)
      pushToast({ tone: 'success', title: t('admin.mfaPolicySaved') })
    } catch (err) {
      pushToast({ tone: 'error', title: t('admin.mfaPolicySaveFailed'), body: toastErrorBody(err, t) })
    } finally {
      setSaving(false)
    }
  }

  const dirty = policy ? !sameRoles(selected, policy.required_roles) : false

  return (
    <Card className="p-5">
      <CardHeader title={t('admin.mfaPolicyTitle')} icon={<ShieldCheck className="h-5 w-5" />} />
      {!policy ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('admin.mfaPolicyHint')}</p>
          <fieldset className="space-y-2" aria-label={t('admin.mfaPolicyTitle')}>
            {policy.available_roles.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-navy-900">
                <input type="checkbox" checked={selected.includes(role)} onChange={() => toggle(role)} />
                {t(`roles.${role}`)}
              </label>
            ))}
          </fieldset>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{t('admin.mfaPolicyDemoNote')}</p>
          {!authMode.authEnabled && <p className="text-xs text-amber-800">{t('admin.mfaPolicyAuthOff')}</p>}
          <p className="text-xs text-slate-500">{t(`admin.mfaPolicySource.${policy.source in SOURCES ? policy.source : 'default'}`)}</p>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? t('admin.saving') : t('admin.mfaPolicySave')}
          </Button>
        </div>
      )}
    </Card>
  )
}

const SOURCES = { admin: true, env: true, default: true } as const
