import { expect, test } from '@playwright/test'
import { loginAs, switchRole } from './helpers/auth'

/**
 * Owner imaging request → demo payment → vet verify → linked case.
 * Uses UI wizard + prefilled demo card 4242… (no real charge).
 */
test.describe.configure({ mode: 'serial' })

test.describe('Owner demo payment → vet verify', () => {
  test('wizard pays with test card and vet accepts into a case', async ({ page }) => {
    const petName = `E2E-Pet-${Date.now().toString(36)}`

    // 1. Owner creates a pet
    await loginAs(page, 'owner@demo.local')
    await page.goto('/hayvanlar')
    await expect(page.getByText(/Pet profilleri|Yeni pet/i).first()).toBeVisible({ timeout: 20_000 })
    const nameField = page.locator('label').filter({ hasText: /Ad \*/i }).locator('input').first()
    await nameField.fill(petName)
    await page.getByRole('button', { name: /Pet kaydet/i }).click()
    await expect(page.getByText(new RegExp(petName, 'i')).first()).toBeVisible({ timeout: 20_000 })

    // 2. Owner submission wizard
    await page.goto('/basvurular')
    await expect(page.getByText(/Başvuru|Görüntüleme|Talep/i).first()).toBeVisible({ timeout: 20_000 })

    // Select the pet we created
    const petSelect = page.locator('select').first()
    await expect(petSelect).toBeVisible({ timeout: 15_000 })
    await petSelect.selectOption({ label: petName })

    await page.getByRole('button', { name: /Devam · DICOM/i }).click()
    await page.getByRole('button', { name: /Örnek DICOM kullan/i }).click()
    await page.getByRole('button', { name: /Devam · Özet/i }).click()
    await page.getByRole('button', { name: /Ödeme ekranına geç/i }).click()

    await expect(page.getByText(/100\s*EUR|demo \(simüle\)|Ödeme özeti/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // Card fields are prefilled with DEMO_TEST_CARD — just submit
    const payBtn = page.getByRole('button', { name: /Öde · 100 EUR/i })
    await expect(payBtn).toBeEnabled({ timeout: 15_000 })
    await payBtn.click()

    await expect(page.getByText(/Ödeme onaylandı|Onaylandı|Vet onayı|pending/i).first()).toBeVisible({
      timeout: 60_000,
    })

    // 3. Vet verifies
    await switchRole(page, 'Veteriner Hekim')
    await page.goto('/basvurular')
    await expect(page.getByText(/Başvuru|Doğrulama|Bekleyen/i).first()).toBeVisible({ timeout: 20_000 })

    // Prefer matching the pet name on the board
    const petRow = page.getByText(new RegExp(petName, 'i')).first()
    await expect(petRow).toBeVisible({ timeout: 30_000 })
    await petRow.click()

    const accept = page.getByRole('button', { name: /Doğrula \+ Vaka Aç|Doğrula|Kabul/i }).first()
    await expect(accept).toBeVisible({ timeout: 30_000 })
    await accept.click()

    await expect(page.getByText(/Vaka|bağlandı|linked|case-|VM-/i).first()).toBeVisible({
      timeout: 45_000,
    })
  })
})
