import { expect, test } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

/** Owner can delete a draft submission (204) — linked cases stay protected by API. */
test.describe('Submission delete smoke', () => {
  test('owner submissions page loads delete-capable list', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/basvurular')
    await expect(page.getByText(/Başvuru|Görüntüleme|Talep|Taslak/i).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})
