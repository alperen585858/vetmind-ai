/**
 * Client-side mirror of the backend password policy (backend/app/auth/passwords.py):
 * at least 8 characters, at most 120, with at least one letter and one digit.
 * The backend stays the authority; this only gives instant feedback.
 */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 120

export type PasswordProblem = 'tooShort' | 'tooLong' | 'needsLetterAndDigit'

export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort'
  if (password.length > MAX_PASSWORD_LENGTH) return 'tooLong'
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'needsLetterAndDigit'
  return null
}

export type PasswordStrength = 0 | 1 | 2 | 3

/** 0 = does not meet the policy, 1 = meets it, 2 = good, 3 = strong. */
export function passwordStrength(password: string): PasswordStrength {
  if (passwordProblem(password)) return 0
  let score = 1
  if (password.length >= 12) score += 1
  const classes = [/[a-zçğıöşü]/u, /[A-ZÇĞİÖŞÜ]/u, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(password)).length
  if (classes >= 3) score += 1
  return Math.min(score, 3) as PasswordStrength
}
