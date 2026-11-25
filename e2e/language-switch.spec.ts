import { expect, test } from '@playwright/test'

// English texts are loaded on demand (src/i18n; the entry-bundle size is checked by
// npm run check:bundle). Switching must show English, and a returning English user must
// start in English after a reload.
test('switching to English loads the English texts and survives a reload', async ({ page }) => {
  await page.goto('/giris')
  await expect(page.getByRole('heading', { name: 'Giriş yap', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'TR', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Giriş yap', exact: true })).toBeVisible()
})
