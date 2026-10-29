import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Loader2, LogOut, Monitor, Save, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { ROLE_LABELS } from '../data/mock'
import { ROLE_BADGE } from '../components/Topbar'
import {
  BackendUnavailableError,
  getUserSettings,
  updateUserSettings,
  type BackendUserSettings,
} from '../lib/backend'

const COLLAPSE_KEY = 'vetmind.sidebar.collapsed'

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start justify-between gap-4 rounded-xl px-1 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50'}`}>
      <span>
        <span className="block text-sm font-medium text-navy-900">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-teal-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

function applySidebarPref(compact: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, compact ? '1' : '0')
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('vetmind-sidebar-collapse'))
}

export default function Settings() {
  const { role, user, signOut, pushToast, applyUserProfile } = useApp()
  const nav = useNavigate()
  const [settings, setSettings] = useState<BackendUserSettings | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [org, setOrg] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void getUserSettings()
      .then((s) => {
        if (cancelled) return
        setSettings(s)
        setDisplayName(s.display_name || user?.name || '')
        setOrg(s.org || user?.org || '')
        applySidebarPref(s.compact_sidebar)
        setDirty(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(
          err instanceof BackendUnavailableError
            ? 'Backend kapalı — ayarlar sunucuya kaydedilemez.'
            : err instanceof Error
              ? err.message
              : 'Ayarlar yüklenemedi',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.name, user?.org])

  const setBool = (key: keyof BackendUserSettings, value: boolean) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
    setDirty(true)
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await updateUserSettings({
        display_name: displayName.trim(),
        org: org.trim(),
        email_notifications: settings.email_notifications,
        push_notifications: settings.push_notifications,
        report_ready_alerts: settings.report_ready_alerts,
        message_alerts: settings.message_alerts,
        compact_sidebar: settings.compact_sidebar,
        language: settings.language,
      })
      setSettings(saved)
      setDisplayName(saved.display_name)
      setOrg(saved.org)
      applyUserProfile({
        displayName: saved.display_name.trim() || user?.name || '',
        org: saved.org,
      })
      applySidebarPref(saved.compact_sidebar)
      setDirty(false)
      pushToast({ tone: 'success', title: 'Ayarlar kaydedildi', body: 'Tercihler sunucuya yazıldı.' })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Kaydedilemedi',
        body: err instanceof Error ? err.message : 'Sunucu hatası',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!role || !user) return null

  return (
    <>
      <PageHeader
        title="Ayarlar"
        subtitle="Profil ve tercihler · sunucu tarafında saklanır"
        crumbs={[{ label: 'Kontrol Paneli', to: '/' }, { label: 'Ayarlar' }]}
        actions={
          <Button
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            onClick={() => void save()}
            disabled={!settings || saving || loading || !dirty}
          >
            Kaydet
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      )}

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Ayarlar yükleniyor…
        </Card>
      ) : settings ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <CardHeader title="Profil" icon={<UserRound className="h-5 w-5" />} />
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-lg font-bold text-white">
                {user.initials}
              </div>
              <div>
                <p className="font-semibold text-navy-900">{displayName || user.name}</p>
                <p className="text-sm text-slate-500">{user.title}</p>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ROLE_BADGE[role]}`}>
                  {ROLE_LABELS[role]}
                </span>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="label">Görünen ad</span>
                <input
                  className="input mt-1"
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="block">
                <span className="label">Kurum / klinik</span>
                <input
                  className="input mt-1"
                  value={org}
                  placeholder="İsteğe bağlı"
                  onChange={(e) => {
                    setOrg(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="block">
                <span className="label">Hesap (subject)</span>
                <input className="input mt-1 bg-slate-50 font-mono text-xs" value={settings.subject} readOnly />
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Bildirimler" icon={<Bell className="h-5 w-5" />} />
            <div className="mt-3 divide-y divide-slate-100">
              <Toggle
                checked={settings.email_notifications}
                onChange={(v) => setBool('email_notifications', v)}
                label="E-posta bildirimleri"
                hint="Rapor ve başvuru güncellemeleri"
              />
              <Toggle
                checked={settings.push_notifications}
                onChange={(v) => setBool('push_notifications', v)}
                label="Uygulama bildirimleri"
                hint="Üst bardaki bildirim zili"
              />
              <Toggle
                checked={settings.report_ready_alerts}
                onChange={(v) => setBool('report_ready_alerts', v)}
                label="Rapor hazır olduğunda bildir"
              />
              <Toggle
                checked={settings.message_alerts}
                onChange={(v) => setBool('message_alerts', v)}
                label="Yeni mesaj uyarıları"
              />
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Arayüz" icon={<Monitor className="h-5 w-5" />} />
            <div className="mt-3 space-y-3">
              <Toggle
                checked={settings.compact_sidebar}
                onChange={(v) => setBool('compact_sidebar', v)}
                label="Dar menü (ikon şeridi)"
                hint="Sol menüyü varsayılan olarak daralt"
              />
              <label className="block">
                <span className="label">Dil</span>
                <select
                  className="input mt-1"
                  value={settings.language}
                  onChange={(e) => {
                    setSettings({ ...settings, language: e.target.value as 'tr' | 'en' })
                    setDirty(true)
                  }}
                >
                  <option value="tr">Türkçe</option>
                  <option value="en">English (yakında)</option>
                </select>
              </label>
              {settings.updated_at && (
                <p className="text-[11px] text-slate-400">
                  Son güncelleme: {new Date(settings.updated_at).toLocaleString('tr-TR')}
                </p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Hesap" icon={<SettingsIcon className="h-5 w-5" />} />
            <p className="mt-2 text-sm text-slate-600">
              Tercihler kullanıcı hesabına bağlıdır ve backend’de saklanır. Çıkış oturumu kapatır; ayarlar silinmez.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="danger"
                icon={<LogOut className="h-4 w-4" />}
                onClick={() => {
                  signOut()
                  nav('/giris')
                  pushToast({ tone: 'info', title: 'Oturum kapatıldı' })
                }}
              >
                Çıkış yap
              </Button>
              <Button variant="secondary" onClick={() => void save()} disabled={!dirty || saving}>
                Tercihleri kaydet
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  )
}
