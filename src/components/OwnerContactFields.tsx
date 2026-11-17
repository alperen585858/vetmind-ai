import { useEffect, useState } from 'react'
import { useLocale } from '../context/LocaleContext'
import { searchOwners, type OwnerSearchHit } from '../lib/backend'

export type OwnerContactValue = {
  ownerName: string
  ownerEmail: string
  ownerEmailConsent: boolean
  petOwnerSubject: string | null
  mode: 'member' | 'guest'
}

export function OwnerContactFields({
  value,
  onChange,
  disabled,
}: {
  value: OwnerContactValue
  onChange: (next: OwnerContactValue) => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<OwnerSearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (value.mode !== 'member') return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void searchOwners(q)
        .then((res) => {
          if (!cancelled) setHits(res.items)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, value.mode])

  return (
    <div
      data-testid="owner-contact-fields"
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
    >
      <div>
        <p className="text-sm font-semibold text-navy-900">{t('ownerContact.title')}</p>
        <p className="mt-0.5 text-xs text-slate-500">{t('ownerContact.hint')}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            value.mode === 'member' ? 'bg-teal-700 text-white' : 'bg-white text-navy-800 ring-1 ring-slate-200'
          }`}
          onClick={() => onChange({ ...value, mode: 'member', petOwnerSubject: value.petOwnerSubject })}
        >
          {t('ownerContact.modeMember')}
        </button>
        <button
          type="button"
          data-testid="owner-contact-guest"
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            value.mode === 'guest' ? 'bg-teal-700 text-white' : 'bg-white text-navy-800 ring-1 ring-slate-200'
          }`}
          onClick={() => onChange({ ...value, mode: 'guest', petOwnerSubject: null })}
        >
          {t('ownerContact.modeGuest')}
        </button>
      </div>

      {value.mode === 'member' ? (
        <div className="space-y-2">
          <label className="block text-xs text-slate-600">
            {t('ownerContact.search')}
            <input
              className="input mt-1 text-sm"
              value={query}
              disabled={disabled}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ownerContact.searchPlaceholder')}
            />
          </label>
          {searching ? <p className="text-xs text-slate-500">{t('common.loading')}</p> : null}
          {hits.length > 0 ? (
            <ul className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm">
              {hits.map((h) => (
                <li key={h.subject}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-teal-50"
                    onClick={() => {
                      onChange({
                        ...value,
                        mode: 'member',
                        ownerName: h.display_name,
                        ownerEmail: h.email,
                        petOwnerSubject: h.subject,
                      })
                      setQuery(h.email)
                      setHits([])
                    }}
                  >
                    <span>
                      <span className="font-medium text-navy-900">{h.display_name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{h.email}</span>
                    </span>
                    <span className="text-[10px] uppercase text-slate-400">{h.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {value.petOwnerSubject ? (
            <p className="text-xs text-teal-800">
              {t('ownerContact.selected', { email: value.petOwnerSubject })}
            </p>
          ) : (
            <p className="text-xs text-amber-800">{t('ownerContact.selectRequired')}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">
            {t('ownerContact.name')} *
            <input
              data-testid="owner-contact-name"
              className="input mt-1 text-sm"
              value={value.ownerName}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, ownerName: e.target.value })}
              placeholder={t('ownerContact.namePlaceholder')}
            />
          </label>
          <label className="block text-xs text-slate-600">
            {t('ownerContact.email')} *
            <input
              data-testid="owner-contact-email"
              className="input mt-1 text-sm"
              type="email"
              value={value.ownerEmail}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, ownerEmail: e.target.value })}
              placeholder={t('ownerContact.emailPlaceholder')}
            />
          </label>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input
          data-testid="owner-contact-consent"
          type="checkbox"
          className="mt-0.5"
          checked={value.ownerEmailConsent}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, ownerEmailConsent: e.target.checked })}
        />
        <span>{t('ownerContact.consent')}</span>
      </label>
      {!value.ownerEmailConsent ? (
        <p className="text-[11px] text-slate-500">{t('ownerContact.consentHint')}</p>
      ) : null}
    </div>
  )
}
