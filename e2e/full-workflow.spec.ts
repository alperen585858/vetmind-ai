import { expect, test } from '@playwright/test'
import { loginAsVet, switchRole } from './helpers/auth'
import {
  approveReport,
  confirmAndRunDemoAnalysis,
  expectMockProcessing,
  loadBrainMriDemo,
  navigateSlices,
  openCaseHistory,
  openDicomUpload,
  openExpertReviewForCase,
} from './helpers/workflow'

/**
 * Full DICOM → mock AI → expert approve → report history → print view.
 * Uses real local backend (isolated sqlite) + synthetic Brain MRI fixtures.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Full clinical workflow (synthetic)', () => {
  let caseId = ''
  const patientName = `E2E-Pax-${Date.now().toString(36)}`

  test('DICOM upload page → viewer image → slice navigation → analyze → expert approve → versions → print view', async ({
    page,
  }) => {
    await loginAsVet(page)
    await openDicomUpload(page)

    // 1–2. Load demo DICOM
    await loadBrainMriDemo(page)

    // 3–4. Viewer shows pixels; navigate slices
    await navigateSlices(page)

    // 5–8. Classification confirm + mock analysis → terminal processing page
    caseId = await confirmAndRunDemoAnalysis(page, patientName)
    await expectMockProcessing(page)
    await expect(page.getByText(new RegExp(patientName, 'i')).first()).toBeVisible()

    // 9–10. Case detail: synthetic findings / provenance
    await page.goto(`/vakalar/${caseId}`)
    await expect(page.getByText(/Bulgular|Rapor|mock|sentetik|SYNTHETIC|DEMO/i).first()).toBeVisible({
      timeout: 20_000,
    })
    // Open findings / overview content from backend hydrate
    await page.getByRole('tab', { name: /AI Bulguları|Bulgular/i }).or(page.getByRole('button', { name: /^AI Bulguları$/i })).first().click()
    await expect(page.getByText(/mock|SYNTHETIC|sentetik|source_kind/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // 11. Authorized expert review
    await switchRole(page, 'Uzman Hekim (VRM)')
    await openExpertReviewForCase(page, caseId)
    // Demo provenance banner (wording: "Demo çıktı. Klinik tanı veya sertifikasyon iddiası yoktur.")
    await expect(page.getByText(/Demo çıktı|sertifikasyon iddiası|source_kind=mock/i).first()).toBeVisible()
    await approveReport(page)

    // 12. Report version persistence
    await switchRole(page, 'Veteriner Hekim')
    await openCaseHistory(page, caseId)
    await expect(page.getByText(/v\s*1|sürüm\s*1|immutable|onay|approved/i).first()).toBeVisible({
      timeout: 20_000,
    })

    // 13–14. Approved report print layout content
    await page.goto(`/raporlar/${caseId}`)
    await expect(page.getByText(/Veteriner Radyoloji Değerlendirme Raporu/i)).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.getByText(/DEMO|SENTETİK|SYNTHETIC|MOCK/i).first()).toBeVisible()
    await expect(page.getByText(new RegExp(patientName, 'i')).first()).toBeVisible()
    // Version picker only appears with >1 version and the "Sürüm:" / DEMO badge lines were
    // removed on purpose (45da3ec, f887f85): check the report number + synthetic disclaimer instead.
    await expect(page.getByText(/Rapor No/i).first()).toBeVisible()

    const printBtn = page.getByRole('button', { name: /PDF indir|PDF olarak indir/i })
    await expect(printBtn).toBeEnabled({ timeout: 20_000 })

    // Report article provenance (not sidebar "mock veri")
    const article = page.locator('article')
    await expect(article.getByText(/Veteriner Radyoloji Değerlendirme Raporu/i)).toBeVisible()
    await expect(article.getByText(/Rapor No/i).first()).toBeVisible()
    await expect(article.getByText(/SENTETİK TASLAK RAPOR/i).first()).toBeVisible()
    await expect(article.getByText(/onay|approved|Review/i).first()).toBeVisible()

    // Chromium print stylesheet + PDF generation (window.print stack preserved).
    // Content assertions use the print media DOM; PDF binary may compress text streams.
    await page.emulateMedia({ media: 'print' })
    await expect(article.getByText(/Veteriner Radyoloji Değerlendirme Raporu/i)).toBeVisible()
    await expect(article.getByText(/SENTETİK TASLAK RAPOR/i).first()).toBeVisible()
    await expect(article.getByText(new RegExp(patientName, 'i')).first()).toBeVisible()
    const pdf = await page.pdf({ printBackground: true, format: 'A4' })
    expect(pdf.byteLength).toBeGreaterThan(2_000)
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-')
  })
})
