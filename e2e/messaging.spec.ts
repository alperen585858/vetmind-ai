import { expect, test } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

test.describe('Messaging smoke', () => {
  test('owner can open messages hub', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/mesajlar')
    await expect(page.getByRole('heading', { name: /Mesajlar|Destek/i }).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})
