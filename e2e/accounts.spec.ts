import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { fillRegister, signOutFromSettings, uniqueEmail } from './helpers/accounts'

/**
 * Issue #31 — server-side accounts in the browser (demo mode, auth off).
 * The emailed link itself is not readable here (no mailbox); the real-token reset flow is
 * exercised through the admin "reset link" instead.
 */
test.describe('Accounts: sign-up, sign-in, password recovery', () => {
  test('the sign-up form has no pet-owner option (B2B)', async ({ page }) => {
    await page.goto('/kayit')
    await expect(page.getByLabel('Rol')).toHaveCount(0)
    await expect(page.getByText(/Hayvan sahibi/i)).toHaveCount(0)
  })

  test('the removed owner demo account cannot sign in', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill('owner@demo.local')
    await page.getByLabel(/Şifre/i).fill('demo1234')
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page.getByText('Invalid email or password.')).toBeVisible()
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

  test('vet sign-up asks to verify the email and cannot sign in yet', async ({ page }) => {
    const email = uniqueEmail('vet')
    await fillRegister(page, { email, password: 'Patiler2026' })
    await expect(page.getByRole('heading', { name: 'E-postanızı kontrol edin' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Doğrulama e-postasını yeniden gönder' })).toBeVisible()

    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByLabel(/Şifre/i).fill('Patiler2026')
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page.getByText('Invalid email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/giris$/)
  })

  test('duplicate email gets the same answer (issue #41)', async ({ page }) => {
    await fillRegister(page, { email: 'vet@demo.local', password: 'Patiler2026' })
    await expect(page.getByRole('heading', { name: 'E-postanızı kontrol edin' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('resend after sign-up confirms without revealing the account and then waits', async ({ page }) => {
    await fillRegister(page, { email: uniqueEmail('resend'), password: 'Patiler2026' })
    await page.getByRole('button', { name: 'Doğrulama e-postasını yeniden gönder' }).click()
    await expect(page.getByText('Bu adreste doğrulanmamış bir hesap varsa')).toBeVisible()
    await expect(page.getByRole('button', { name: /Yeniden göndermek için \d+ sn/ })).toBeDisabled()
  })

  test('verify page hides the token, rejects an invalid one and offers a new link', async ({ page }) => {
    await page.goto('/eposta-dogrula?token=this-token-does-not-exist-anywhere-1234')
    await expect(page).toHaveURL(/\/eposta-dogrula$/)
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')
    await expect(page.getByText('Bu doğrulama bağlantısı geçersiz')).toBeVisible()
    await page.getByLabel('E-posta').fill(uniqueEmail('nobody'))
    await page.getByRole('button', { name: 'Doğrulama e-postasını yeniden gönder' }).click()
    await expect(page.getByText('Bu adreste doğrulanmamış bir hesap varsa')).toBeVisible()
  })

  test('admin marks a new vet verified, activates, and the vet signs in', async ({ page }) => {
    const email = uniqueEmail('verify-admin')
    await fillRegister(page, { email, password: 'Patiler2026' })
    await expect(page.getByRole('heading', { name: 'E-postanızı kontrol edin' })).toBeVisible()

    await loginAs(page, 'admin@demo.local')
    await page.goto('/kullanicilar')
    const row = page.getByRole('row').filter({ hasText: email })
    await expect(row.getByText('E-posta doğrulanmadı')).toBeVisible({ timeout: 20_000 })
    await expect(row.getByRole('button', { name: 'Aktifleştir' })).toBeDisabled()
    await row.getByRole('button', { name: 'Doğrulanmış işaretle' }).click()
    await expect(row.getByText('E-posta doğrulanmadı')).toHaveCount(0)
    await row.getByRole('button', { name: 'Aktifleştir' }).click()
    await expect(row.getByRole('button', { name: 'Pasifleştir' })).toBeVisible()

    await signOutFromSettings(page)
    await loginAs(page, email, 'Patiler2026')
  })

  test('forgot password gives the same answer for any address', async ({ page }) => {
    await page.goto('/giris')
    await page.getByRole('link', { name: 'Şifremi unuttum' }).click()
    await expect(page).toHaveURL(/\/sifremi-unuttum$/)

    for (const email of ['clinic-owner@demo.local', uniqueEmail('nobody')]) {
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

  test('admin creates a user, the user signs in, admin reset link sets a new password', async ({ page }) => {
    const email = uniqueEmail('admin-made')
    await loginAs(page, 'admin@demo.local')
    await page.goto('/kullanicilar')
    const form = page.getByRole('main')
    await form.getByLabel('E-posta').fill(email)
    await form.getByLabel('Şifre').fill('Patiler2026')
    await form.getByLabel('Rol').selectOption('admin')
    await form.getByRole('button', { name: 'Oluştur' }).click()
    const row = page.getByRole('row').filter({ hasText: email })
    await expect(row).toBeVisible({ timeout: 20_000 })

    await row.getByRole('button', { name: 'Sıfırlama linki' }).click()
    const linkField = page.getByLabel('Sıfırlama linki', { exact: true })
    await expect(linkField).toHaveValue(/\/sifre-sifirla\?token=/)
    const link = new URL(await linkField.inputValue())

    await signOutFromSettings(page)
    await loginAs(page, email, 'Patiler2026')
    await signOutFromSettings(page)

    await page.goto(`${link.pathname}${link.search}`)
    await page.getByLabel('Yeni şifre').fill('Yeni-Sifre-2027')
    await page.getByLabel('Şifre (tekrar)').fill('Yeni-Sifre-2027')
    await page.getByRole('button', { name: 'Şifreyi kaydet' }).click()
    await expect(page.getByRole('heading', { name: 'Şifreniz değişti' })).toBeVisible()

    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByLabel(/Şifre/i).fill('Patiler2026')
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page.getByText('Invalid email or password.')).toBeVisible()
    await loginAs(page, email, 'Yeni-Sifre-2027')
  })

  test('expired session notice shows on the login page', async ({ page }) => {
    await page.goto('/giris?expired=1')
    await expect(page.getByText('Oturumunuzun süresi doldu')).toBeVisible()
  })
})
