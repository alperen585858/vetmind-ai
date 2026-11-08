import { expect, test } from '@playwright/test'
import {
  exportTraining,
  openAnnotationWorkspace,
  seedAnnotatedCase,
  verifyEvidenceViaApi,
} from './helpers/annotation'

/**
 * P1.10 — annotation overlays / edit / verify / export (synthetic, no Gemini).
 */
test.describe.configure({ mode: 'serial' })

test.describe('Annotation overlays (P1.6–P1.9)', () => {
  test('multi-overlay, toggle, ungrounded filter, draw save, verify→export', async ({
    page,
    request,
  }) => {
    const seeded = await seedAnnotatedCase(request, { ungrounded: true })
    expect(seeded.evidenceIds.length).toBeGreaterThanOrEqual(2)

    await openAnnotationWorkspace(page, seeded.caseId)

    // Findings panel labels
    await expect(page.getByText(/^F1$/).first()).toBeVisible({ timeout: 20_000 })

    // Wait for DICOM viewer + overlay counter (SOP match once frames hydrate)
    const overlayToggle = page.getByRole('button', { name: /Overlay:/i })
    await expect(overlayToggle).toBeVisible({ timeout: 30_000 })

    // Allow frame SOP hydrate; count may be 0 until SOP known, then ≥1
    await expect
      .poll(async () => {
        const label = page.locator('span', { hasText: /doğrulanmış kutu|İşaretlemeler gizli/i })
        return (await label.first().textContent()) || ''
      }, { timeout: 45_000 })
      .toMatch(/doğrulanmış kutu|İşaretlemeler gizli/)

    // Prefer grounded overlays when SOP resolved
    const countText = await page.locator('span', { hasText: /doğrulanmış kutu/i }).first().textContent().catch(() => null)
    if (countText) {
      const n = Number(countText.match(/(\d+)/)?.[1] || 0)
      // Two seeded with SOP + optional ungrounded ignored → expect 2 when SOP known
      if (seeded.sop) expect(n).toBeGreaterThanOrEqual(2)
    }

    // Toggle off → hidden
    await overlayToggle.click()
    await expect(page.getByText(/İşaretlemeler gizli/i)).toBeVisible()
    await overlayToggle.click()

    // Annotate tool present
    const bboxTool = page.getByRole('button', { name: /Anotasyon kutusu|BBox/i })
    await expect(bboxTool).toBeVisible({ timeout: 15_000 })
    await bboxTool.click()

    const viewer = page.getByRole('application', { name: /DICOM/i }).or(page.locator('canvas').first())
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (box) {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45)
      await page.mouse.up()
      const save = page.getByRole('button', { name: /^Kaydet$/i })
      if (await save.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await save.click()
        await expect(page.getByText(/doğrulanmış kutu/i).first()).toBeVisible({ timeout: 15_000 })
      }
    }

    // Verify UI (expert) + export count
    const verifyBtn = page.getByRole('button', { name: /Verify \(export\)/i }).first()
    await expect(verifyBtn).toBeVisible({ timeout: 15_000 })
    await verifyBtn.click()
    await expect(page.getByText(/^Verified/i).first()).toBeVisible({ timeout: 15_000 })

    // Ensure at least one evidence verified via API for deterministic export assert
    await verifyEvidenceViaApi(request, seeded.caseId, seeded.evidenceIds[0]!)
    const exported = await exportTraining(request, seeded.caseId)
    expect(exported.manifest.row_count).toBeGreaterThanOrEqual(1)
    expect(exported.rows.every((r) => !('patient_name' in r))).toBeTruthy()
    expect(exported.rows.every((r) => !String(r.patient_id).includes(' '))).toBeTruthy()

    // Ungrounded finding evidence exists in panel but does not force overlay draw without SOP
    await expect(page.getByText(/ungrounded E2E|E2E seeded mark/i).first()).toBeVisible()
    void viewer
  })
})
