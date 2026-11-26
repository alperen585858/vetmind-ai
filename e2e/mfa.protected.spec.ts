import { expect, test } from '@playwright/test'
import { loginProtected } from './helpers/protectedAuth'
import { signOutFromSettings } from './helpers/accounts'
import { currentStep, totpAt } from './helpers/totp'

/**
 * Issue #107 — two-step sign-in (runs in the e2e-protected project: auth on).
 * Uses a fresh admin-created account; demo accounts are only checked to be unaffected.
 */
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'
const PASSWORD = 'Patiler2026'

test('turn on 2FA, sign in with an app code, then with a backup code', async ({ page, request }) => {
  const email = `mfa-${Date.now().toString(36)}@e2e.test`
  const admin = await request.post(`${API}/auth/login`, { data: { email: 'admin@demo.local', password: 'demo1234' } })
  expect(admin.ok(), await admin.text()).toBeTruthy()
  const created = await request.post(`${API}/admin/users`, {
    headers: { Authorization: `Bearer ${(await admin.json()).access_token}` },
    data: { email, password: PASSWORD, role: 'admin' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()

  // Set up from Settings.
  await loginProtected(page, email, PASSWORD)
  await page.goto('/ayarlar')
  await page.getByRole('button', { name: 'İki adımlı doğrulamayı aç' }).click()
  await expect(page.getByRole('img', { name: 'İki adımlı doğrulama QR kodu' })).toBeVisible()
  const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '')
  const enabledStep = currentStep()
  await page.getByLabel('Uygulamadaki 6 haneli kod').fill(totpAt(secret, enabledStep))
  await page.getByRole('button', { name: 'Onayla ve aç' }).click()

  const codesList = page.getByRole('list', { name: 'Yedek kodlar' })
  await expect(codesList.getByRole('listitem')).toHaveCount(10)
  const backup = (await codesList.getByRole('listitem').first().innerText()).trim()
  await expect(page.getByRole('button', { name: 'Tamam' })).toBeDisabled()
  await page.getByLabel('Kodları güvenli bir yere kaydettim').check()
  await page.getByRole('button', { name: 'Tamam' }).click()
  await expect(page.getByText('Açık · 10 yedek kod kaldı')).toBeVisible()

  // Password alone is no longer enough.
  await signOutFromSettings(page)
  await page.goto('/giris')
  await page.getByLabel(/E-posta/i).fill(email)
  await page.getByLabel(/Şifre/i).fill(PASSWORD)
  await page.getByRole('button', { name: /Giriş yap/i }).click()
  await expect(page.getByRole('heading', { name: 'İki adımlı doğrulama' })).toBeVisible()
  await page.getByLabel('Doğrulama kodu').fill('000000')
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  // Next step's code: never the one used to turn 2FA on (replay is refused).
  await page.getByLabel('Doğrulama kodu').fill(totpAt(secret, enabledStep + 1))
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 })

  // Backup code path.
  await signOutFromSettings(page)
  await page.goto('/giris')
  await page.getByLabel(/E-posta/i).fill(email)
  await page.getByLabel(/Şifre/i).fill(PASSWORD)
  await page.getByRole('button', { name: /Giriş yap/i }).click()
  await page.getByRole('button', { name: 'Yedek kod kullan' }).click()
  await page.getByLabel('Yedek kod').fill(backup)
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 })
  await page.goto('/ayarlar')
  await expect(page.getByText('Açık · 9 yedek kod kaldı')).toBeVisible()
})

test('demo accounts sign in with the password only and cannot turn 2FA on', async ({ page }) => {
  await loginProtected(page, 'expert@demo.local')
  await page.goto('/ayarlar')
  await expect(page.getByText('Demo hesaplarda iki adımlı doğrulama kullanılamaz')).toBeVisible()
  await expect(page.getByRole('button', { name: 'İki adımlı doğrulamayı aç' })).toHaveCount(0)
})

test('admin requires 2FA for a role from the users screen; that role is sent to setup', async ({ page, request }) => {
  const email = `mfa-vet-${Date.now().toString(36)}@e2e.test`
  const admin = await request.post(`${API}/auth/login`, { data: { email: 'admin@demo.local', password: 'demo1234' } })
  const adminToken = (await admin.json()).access_token as string
  const created = await request.post(`${API}/admin/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { email, password: PASSWORD, role: 'vet', clinic_id: 'clinic-demo-a' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()

  try {
    await loginProtected(page, 'admin@demo.local')
    await page.goto('/kullanicilar')
    const card = page.getByRole('group', { name: 'İki adımlı doğrulama zorunluluğu' })
    await card.getByLabel('Veteriner Hekim').check()
    await page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('2FA zorunluluğu kaydedildi')).toBeVisible()
    await expect(page.getByText('Bu ekrandan kaydedildi.')).toBeVisible()

    // A vet signing in now can only set 2FA up; the demo admin above was not affected.
    await signOutFromSettings(page)
    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByLabel(/Şifre/i).fill(PASSWORD)
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page).toHaveURL(/\/ayarlar\?mfa=kurulum/)
    await expect(page.getByText('Rolünüz için iki adımlı doğrulama zorunlu')).toBeVisible()
  } finally {
    await request.put(`${API}/admin/mfa-policy`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { required_roles: [] },
    })
  }
})
