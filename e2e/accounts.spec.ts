import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { fillRegister, signOutFromSettings, uniqueEmail } from './helpers/accounts'

/**
 * Issue #31 — server-side accounts in the browser (demo mode, auth off).
 * The full reset-with-emailed-token flow is covered by backend tests: the e2e run has
 * no mailbox to read the link from.
 */
test.describe('Accounts: sign-up, sign-in, password recovery', () => {
  test('pet owner signs up, signs out and signs back in from another session', async ({ page, context }) => {
    const email = uniqueEmail('owner')
    await fillRegister(page, { name: 'E2E Sahip', email, password: 'Patiler2026' })
    await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })

    const stored = await page.evaluate(() => ({
      session: JSON.parse(localStorage.getItem('vetmind.demo.session') || 'null'),
      refresh: localStorage.getItem('vetmind.backend.refresh'),
      legacy: localStorage.getItem('vetmind.demo.accounts'),
    }))
    expect(stored.session).toMatchObject({ email, role: 'owner', name: 'E2E Sahip' })
    expect(stored.refresh).toBeTruthy()
    expect(stored.legacy).toBeNull() // nothing (and no password) is kept in the browser

    await signOutFromSettings(page)
    await context.clearCookies()
    await page.evaluate(() => localStorage.clear())

    await loginAs(page, email, 'Patiler2026')
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('vetmind.demo.session') || 'null'))
    expect(session).toMatchObject({ email, role: 'owner' })
  })

  test('weak or mismatching passwords are caught before submitting', async ({ page }) => {
    let registerCalls = 0
    page.on('request', (req) => {
      if (req.url().endsWith('/api/v1/auth/register')) registerCalls += 1
    })
    const email = uniqueEmail('weak')

    await fillRegister(page, { email, password: 'kisa1' })
    await expect(page.getByRole('alert')).toHaveText('Şifre en az 8 karakter olmalı.')
    await expect(page.getByText('Şifre gücü: Zayıf')).toBeVisible()

    await fillRegister(page, { email, password: 'Patiler2026', confirm: 'Patiler2027' })
    await expect(page.getByRole('alert')).toHaveText('Şifreler eşleşmiyor.')
    expect(registerCalls).toBe(0)
  })

  test('vet sign-up waits for admin approval and cannot sign in yet', async ({ page }) => {
    const email = uniqueEmail('vet')
    await fillRegister(page, { email, password: 'Patiler2026', role: 'vet' })
    await expect(page.getByRole('heading', { name: 'Hesabınız onay bekliyor' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByLabel(/Şifre/i).fill('Patiler2026')
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page.getByText('Invalid email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/giris$/)
  })

  test('duplicate email is refused', async ({ page }) => {
    await fillRegister(page, { email: 'vet@demo.local', password: 'Patiler2026' })
    await expect(page.getByRole('alert')).toContainText('already exists')
  })

  test('forgot password gives the same answer for any address', async ({ page }) => {
    await page.goto('/giris')
    await page.getByRole('link', { name: 'Şifremi unuttum' }).click()
    await expect(page).toHaveURL(/\/sifremi-unuttum$/)

    for (const email of ['owner@demo.local', uniqueEmail('nobody')]) {
      await page.goto('/sifremi-unuttum')
      await page.getByLabel('E-posta').fill(email)
      await page.getByRole('button', { name: 'Bağlantı gönder' }).click()
      await expect(page.getByRole('heading', { name: 'E-postanızı kontrol edin' })).toBeVisible()
      await expect(page.getByText('Demo modda e-posta gönderilmez')).toBeVisible()
    }
  })

  test('reset page without a token asks for a new link', async ({ page }) => {
    await page.goto('/sifre-sifirla')
    await expect(page.getByText('Bu bağlantı eksik veya bozuk')).toBeVisible()
    await page.getByRole('link', { name: 'Yeni bağlantı iste' }).click()
    await expect(page).toHaveURL(/\/sifremi-unuttum$/)
  })

  test('reset page hides the token and rejects an invalid one', async ({ page }) => {
    await page.goto('/sifre-sifirla?token=this-token-does-not-exist-anywhere-1234')
    await expect(page).toHaveURL(/\/sifre-sifirla$/) // token removed from the address bar
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')

    await page.getByLabel('Yeni şifre').fill('Patiler2026')
    await page.getByLabel('Şifre (tekrar)').fill('Patiler2026')
    await page.getByRole('button', { name: 'Şifreyi kaydet' }).click()
    await expect(page.getByRole('alert')).toContainText('invalid or has expired')
    await expect(page.getByRole('link', { name: 'Yeni bağlantı iste' })).toBeVisible()
  })

  test('English routes work for the new pages', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: /Şifremi unuttum|Forgot your password/ })).toBeVisible()
    await page.goto('/reset-password')
    await expect(page.getByText(/eksik veya bozuk|incomplete or broken/)).toBeVisible()
  })
})
