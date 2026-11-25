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

    // Both seeded boxes carry a SOP: once frames hydrate the counter must reach 2 (the
    // ungrounded one is filtered out). Poll instead of reading once: the counter shows
    // "0 doğrulanmış kutu" until the SOP is known, which made this test flaky under load.
    if (seeded.sop) {
      await expect
        .poll(async () => {
          const text = await page.locator('span', { hasText: /doğrulanmış kutu/i }).first().textContent().catch(() => null)
          return Number(text?.match(/(\d+)/)?.[1] || 0)
        }, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(2)
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
    const verifyBtn = page.getByRole('button', { name: /Eğitim için doğrula|Verify for training/i }).first()
    await expect(verifyBtn).toBeVisible({ timeout: 15_000 })
    await verifyBtn.click()
    await expect(page.getByText(/^(Doğrulandı|Verified)/i).first()).toBeVisible({ timeout: 15_000 })

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
