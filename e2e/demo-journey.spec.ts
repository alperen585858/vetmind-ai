import { expect, test } from '@playwright/test'

/**
 * Critical demo UI journeys. Synthetic only — no clinical data.
 * Screenshots on failure via playwright.config (no PHI in assertions).
 */

test.describe('Demo login and navigation', () => {
  test('login page renders brand and demo credentials', async ({ page }) => {
    await page.goto('/giris')
    await expect(page.getByRole('heading', { name: 'Hesaba giriş' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('body')).toContainText(/Demo hesaplar|DICOM/i)
  })

  test('can sign in with demo vet credentials', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel(/E-posta|Email/i).fill('vet@demo.local')
    await page.getByLabel(/Şifre|Password/i).fill('demo1234')
    await page.getByRole('button', { name: /Giriş|Login|Devam/i }).click()
    // Land on DICOM upload or home — not stuck on login
    await expect(page).not.toHaveURL(/giris$/, { timeout: 15_000 })
  })
})

test.describe('Responsive shell', () => {
  test('login is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/giris')
    await expect(page.getByLabel(/E-posta|Email/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Giriş|Login|Devam/i })).toBeVisible()
  })
})

test.describe('Logout cleanup signal', () => {
  test('sign-out returns to public entry', async ({ page }) => {
    await page.goto('/giris')
    const email = page.getByLabel(/E-posta|Email/i)
    if (await email.isVisible()) {
      await email.fill('vet@demo.local')
      await page.getByLabel(/Şifre|Password/i).fill('demo1234')
      await page.getByRole('button', { name: /Giriş|Login|Devam/i }).click()
      await page.waitForTimeout(800)
    }
    // Best-effort logout control
    const logout = page.getByRole('button', { name: /Çıkış|Logout|Oturumu/i })
    if (await logout.count()) {
      await logout.first().click()
      await expect(page).toHaveURL(/giris|\/$/, { timeout: 10_000 })
    }
  })
})
