import { expect, test } from '@playwright/test'
import { fillRegister, uniqueEmail } from './helpers/accounts'
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

test.describe('Protected mode accounts (issue #31)', () => {
  test('self sign-up is vet-only and waits for admin approval', async ({ page }) => {
    const email = uniqueEmail('prot-vet')
    await fillRegister(page, { email, password: 'Patiler2026' })
    await expect(page.getByRole('heading', { name: 'Hesabınız onay bekliyor' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(email)).toBeVisible()
  })
})
