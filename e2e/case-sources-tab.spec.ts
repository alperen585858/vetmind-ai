import { expect, test } from '@playwright/test'
import { loginAsVet } from './helpers/auth'
import { confirmAndRunDemoAnalysis, loadBrainMriDemo, openDicomUpload } from './helpers/workflow'

// #76: the Sources tab shows readable information, not internal ids or raw similarity scores.
test('sources tab hides internal ids and raw similarity scores', async ({ page }) => {
  await loginAsVet(page)
  await openDicomUpload(page)
  await loadBrainMriDemo(page)
  const caseId = await confirmAndRunDemoAnalysis(page, `Src-${Date.now().toString(36)}`)

  await page.goto(`/vakalar/${caseId}`)
  await page.getByRole('tab', { name: 'Kaynaklar' }).click()
  const panel = page.getByRole('tabpanel', { name: 'Kaynaklar' })

  // The demo brain MRI draft cites knowledge-base passages linked to its findings.
  const chips = panel.getByTestId('citation-source-id')
  await expect(chips.first()).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByTestId('citation-related-findings').first()).toContainText('İlgili bulgu:')

  // Raw score and internal case/finding ids never show in the default view.
  await expect(panel.getByText(/benzerlik:/i)).toHaveCount(0)
  await expect(panel.getByText(/case-[0-9a-f]{6,}/)).toHaveCount(0)
  await expect(panel.getByText(/^\[(kb|custom|breed|suture)[^\]]*\]/)).toHaveCount(0)

  // The source id is a secondary chip; its tooltip carries the score with a caveat.
  await expect(chips.first()).toHaveAttribute('title', /Metin benzerliği \d\.\d\d; .*klinik güven düzeyi değildir/)
})
