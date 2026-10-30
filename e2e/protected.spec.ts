import { expect, test } from '@playwright/test'
import { loginProtectedExpert } from './helpers/protectedAuth'

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
