import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

test.describe('Messaging smoke', () => {
  test('vet opens messages and starts a support conversation', async ({ page }) => {
    await loginAsVet(page)
    await page.goto('/mesajlar')
    await expect(page.getByRole('heading', { name: /İletişim|Mesajlar|Destek/i }).first()).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Yeni Konuşma' }).first().click()
    await page.getByRole('option', { name: /Destek ekibi/ }).click()
    await page.getByLabel('Konu').fill('E2E destek')
    await page.getByLabel('Mesaj', { exact: true }).fill('Merhaba destek')
    await page.getByRole('dialog').getByRole('button', { name: 'Gönder' }).click()
    await expect(page.getByText('Merhaba destek').first()).toBeVisible({ timeout: 15_000 })
  })

  test('help card opens the support conversation, not an email app', async ({ page }) => {
    await loginAsVet(page)
    await page.goto('/')
    const link = page.getByRole('link', { name: /Destek ekibine yazın/i })
    await expect(link).toHaveAttribute('href', /\/mesajlar\?new=support/)
    await link.click()
    await expect(page.getByRole('dialog')).toContainText('Destek ekibi')
  })
})
