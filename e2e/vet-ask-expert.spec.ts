import { expect, test } from '@playwright/test'
import { loginAsVet, switchRole } from './helpers/auth'
import {
  approveReport,
  confirmAndRunDemoAnalysis,
  expectMockProcessing,
  loadBrainMriDemo,
  openDicomUpload,
  openExpertReviewForCase,
} from './helpers/workflow'

/**
 * Referring vet asks the assigned specialist about an approved report;
 * specialist replies; vet sees the answer on the same thread.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Vet → expert question on approved report', () => {
  let caseId = ''
  const patientName = `E2E-Ask-${Date.now().toString(36)}`
  const question = 'Raporda sol bası yazıyor; klinik sağda. Tekrar bakabilir misiniz?'
  const answer = 'Kesitler yeniden değerlendirildi; sağ lateral bası daha belirgin.'

  test('approve → vet asks expert → expert replies → vet sees reply', async ({ page }) => {
    await loginAsVet(page)
    await openDicomUpload(page)
    await loadBrainMriDemo(page)
    caseId = await confirmAndRunDemoAnalysis(page, patientName)
    await expectMockProcessing(page)

    await switchRole(page, 'Uzman Veteriner Radyolog')
    await openExpertReviewForCase(page, caseId)
    await approveReport(page)

    await switchRole(page, 'Veteriner Hekim')
    await page.goto(`/raporlar/${caseId}`)
    await expect(page.getByText(/Veteriner Radyoloji Değerlendirme Raporu/i)).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.getByText(/Uzmana soru|Ask specialist/i).first()).toBeVisible()

    await page.getByTestId('ask-expert-input').fill(question)
    await page.getByTestId('ask-expert-send').click()
    await expect(page.getByText(question).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Açık|Open/i).first()).toBeVisible()
    await expect(page.getByText(/Uzman radyolog|Specialist radiologist/i).first()).toBeVisible()

    await switchRole(page, 'Uzman Veteriner Radyolog')
    await page.goto(`/raporlar/${caseId}`)
    await expect(page.getByText(question).first()).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('ask-expert-reply-input').fill(answer)
    await page.getByTestId('ask-expert-reply-send').click()
    await expect(page.getByTestId('info-request-reply')).toContainText(answer, { timeout: 15_000 })

    await switchRole(page, 'Veteriner Hekim')
    await page.goto(`/raporlar/${caseId}`)
    await expect(page.getByText(question).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('info-request-reply')).toContainText(answer)
    await expect(page.getByText(/Yanıtlandı|Answered/i).first()).toBeVisible()
  })
})
