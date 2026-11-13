import { expect, test } from '@playwright/test'
import { fillRegister, signOutFromSettings, uniqueEmail } from './helpers/accounts'
import { loginProtected, loginProtectedExpert } from './helpers/protectedAuth'

/**
 * Runs under playwright project `e2e-protected` (auth on, no role switch).
 */
test.describe('Protected mode smoke', () => {
  test('expert lands on review queue after login', async ({ page }) => {
    await loginProtectedExpert(page)
    await page.goto('/kuyruk')
    await expect(page.getByRole('heading', { name: /Onay|İş listesi|Kuyruk/i }).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('Protected mode accounts (issue #31)', () => {
  test('signed-up owner changes the password in Ayarlar and signs in with it', async ({ page }) => {
    const email = uniqueEmail('prot-owner')
    await fillRegister(page, { email, password: 'Patiler2026' })
    await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })

    await page.goto('/ayarlar')
    await expect(page.getByRole('heading', { name: 'Şifre değiştir' })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('Mevcut şifre').fill('Patiler2026')
    await page.getByLabel('Yeni şifre').fill('Yeni-Sifre-2027')
    await page.getByLabel('Şifre (tekrar)').fill('Yeni-Sifre-2027')
    await page.getByRole('button', { name: 'Şifreyi değiştir' }).click()
    await expect(page.getByText('Şifreniz değişti')).toBeVisible()

    // This session survives the change (it got a fresh token pair).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Şifre değiştir' })).toBeVisible({ timeout: 20_000 })

    await signOutFromSettings(page)
    await page.getByLabel(/E-posta/i).fill(email)
    await page.getByLabel(/Şifre/i).fill('Patiler2026')
    await page.getByRole('button', { name: /Giriş yap/i }).click()
    await expect(page.getByText('Invalid email or password.')).toBeVisible()

    await loginProtected(page, email, 'Yeni-Sifre-2027')
    await expect(page).not.toHaveURL(/\/giris$/)
  })
})
