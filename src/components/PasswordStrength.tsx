import { useLocale } from '../context/LocaleContext'
import { passwordProblem, passwordStrength, type PasswordProblem } from '../lib/passwordPolicy'

const PROBLEM_KEY: Record<PasswordProblem, string> = {
  tooShort: 'auth.passwordTooShort',
  tooLong: 'auth.passwordTooLong',
  needsLetterAndDigit: 'auth.passwordNeedsLetterAndDigit',
}

const BAR_COLOR = ['bg-rose-400', 'bg-amber-400', 'bg-teal-500', 'bg-emerald-600']

/** Translated policy message for a new password, or null when it passes. */
export function usePasswordError(): (password: string) => string | null {
  const { t } = useLocale()
  return (password) => {
    const problem = passwordProblem(password)
    return problem ? t(PROBLEM_KEY[problem]) : null
  }
}

/** Live strength bar + policy hint under a new-password field. */
export function PasswordStrength({ password, dark = false }: { password: string; dark?: boolean }) {
  const { t } = useLocale()
  const strength = passwordStrength(password)
  const level = t(`auth.strength${strength}`)
  const muted = dark ? 'text-navy-300' : 'text-navy-500'
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              password && (strength >= i || (strength === 0 && i === 1))
                ? BAR_COLOR[strength]
                : dark
                  ? 'bg-navy-800'
                  : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <p className={`mt-1 text-xs ${muted}`}>
        {password ? t('auth.strengthLabel', { level }) : t('auth.passwordHint')}
      </p>
    </div>
  )
}
