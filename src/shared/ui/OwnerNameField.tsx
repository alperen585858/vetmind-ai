import { Info } from 'lucide-react'
import { useLocale } from '../shell/LocaleContext'

/**
 * Optional pet-owner name for the vet's own records (B2B).
 * Owners have no account and are never emailed, so no email / consent / member lookup here.
 */
export function OwnerNameField({
  value,
  onChange,
  disabled,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useLocale()
  return (
    <fieldset className={`space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 ${className}`}>
      <legend className="px-1 text-sm font-semibold text-navy-900">{t('ownerContact.title')}</legend>
      <label className="block">
        <span className="label">{t('ownerContact.nameLabel')}</span>
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('ownerContact.namePlaceholder')}
          maxLength={120}
          autoComplete="off"
          disabled={disabled}
        />
      </label>
      <p className="flex items-start gap-2 text-xs text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
        <span>{t('ownerContact.noEmailNotice')}</span>
      </p>
    </fieldset>
  )
}
