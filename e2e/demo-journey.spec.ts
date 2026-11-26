import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

/**
 * Critical demo UI journeys. Synthetic only — no clinical data.
 * Screenshots on failure via playwright.config (no PHI in assertions).
 */

test.describe('Demo login and navigation', () => {
  test('login page renders brand and demo credentials', async ({ page }) => {
    await page.goto('/giris')
    await expect(page.getByRole('heading', { name: /^Giriş yap$/i })).toBeVisible({ timeout: 15_000 })
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
    // loginAs waits for the (lazy-loaded) login form. The old `if (await email.isVisible())`
    // checked once without waiting, skipped the sign-in while the page was still loading and
    // then never found the logout button (about 1 run in 3 under load).
    await loginAsVet(page)
    // Below the lg breakpoint (1024 px) the sidebar with "Çıkış yap" is an off-canvas drawer
    // behind the menu button. The hidden logout button still counts as "visible" (it is only
    // outside the viewport), so decide by viewport width, not by visibility.
    const menu = page.getByRole('button', { name: /Menüyü aç|Open menu/i })
    const logout = page.getByRole('button', { name: /Çıkış|Logout|Oturumu/i }).first()
    if ((page.viewportSize()?.width ?? 1280) < 1024) {
      await expect(menu).toBeVisible({ timeout: 20_000 })
      await menu.click()
    }
    await expect(logout).toBeInViewport({ timeout: 20_000 })
    await logout.click()
    await expect(page).toHaveURL(/giris|\/$/, { timeout: 10_000 })
  })
})
