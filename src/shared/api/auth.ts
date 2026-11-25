import { getBackendRefreshToken } from '../auth/session'
import { API_BASE, request } from './client'

/** Optional backend JWT login (used when VETMIND_AUTH_ENABLED=1). */
export async function backendLogin(email: string, password: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  role: string
  email: string
  auth_enabled: boolean
}> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export type BackendTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  role: string
  email: string
  clinic_id?: string | null
  auth_enabled: boolean
}

/**
 * Same answer for a new and an already registered address (issue #41): the backend emails
 * a verification link (or an "you already have an account" note) after responding.
 */
export type BackendRegisterResponse = {
  email: string
  status: 'verification_sent'
  detail: string
}

export async function backendRegister(payload: {
  email: string
  password: string
  role: 'vet'
  display_name?: string
}): Promise<BackendRegisterResponse> {
  return request('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
}

export type BackendVerifyEmailResponse = {
  email: string
  status: 'verified'
  /** Self-registered vets still wait for an admin to activate them. */
  pending_approval: boolean
}

export async function backendVerifyEmail(token: string): Promise<BackendVerifyEmailResponse> {
  return request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
}

/** Always 202 with the same body, whether or not the address has an unverified account. */
export async function backendResendVerification(email: string): Promise<void> {
  await request('/auth/verify-email/resend', { method: 'POST', body: JSON.stringify({ email }) })
}

export async function backendForgotPassword(email: string): Promise<void> {
  await request('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) })
}

export async function backendResetPassword(token: string, newPassword: string): Promise<void> {
  await request('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  })
}

/** Change your own password. Other sessions end; the returned pair keeps this one signed in. */
export async function backendChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<BackendTokenResponse> {
  return request('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

/** Revoke the stored refresh token on the backend. Never throws; call before clearing tokens. */
export async function backendLogout(): Promise<void> {
  const refreshToken = getBackendRefreshToken()
  if (!refreshToken) return
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } catch {
    /* offline: the refresh token simply expires */
  }
}

export async function backendAuthStatus(): Promise<{
  auth_enabled: boolean
  deployment_mode?: string
  tenant_isolation?: boolean
  encryption_at_rest?: string
  malware_scan_required?: boolean
}> {
  return request('/auth/status')
}

export type BackendUserSettings = {
  subject: string
  display_name: string
  org: string
  email_notifications: boolean
  push_notifications: boolean
  report_ready_alerts: boolean
  message_alerts: boolean
  compact_sidebar: boolean
  /** null until the user picks a language (client keeps its own locale). */
  language: 'tr' | 'en' | null
  updated_at: string
}

export type BackendUserSettingsUpdate = Partial<{
  display_name: string
  org: string
  email_notifications: boolean
  push_notifications: boolean
  report_ready_alerts: boolean
  message_alerts: boolean
  compact_sidebar: boolean
  language: 'tr' | 'en'
}>

export async function getUserSettings(): Promise<BackendUserSettings> {
  return request('/settings/me')
}

export async function updateUserSettings(
  patch: BackendUserSettingsUpdate,
): Promise<BackendUserSettings> {
  return request('/settings/me', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
