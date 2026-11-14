import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginAsExpert } from './helpers/auth'
import { openExpertReviewForCase } from './helpers/workflow'

const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'

/** Synthetic thorax radiograph case, analyzed with the mock pipeline (no real model). */
async function seedThoraxXrCase(request: APIRequestContext): Promise<string> {
  const up = await request.post(`${API}/dicom/demo/thorax_xr`, {
    multipart: {
      patient_name: `E2E-VHS-${Date.now().toString(36)}`,
      species: 'canine',
      clinical_history: 'Synthetic VHS E2E — not a real patient.',
    },
  })
  expect(up.ok(), await up.text()).toBeTruthy()
  const ingestId = (await up.json()).ingest_id as string
  const conf = await request.post(`${API}/dicom/ingestions/${ingestId}/confirm`, {
    data: {
      accept_suggestion: true,
      imaging_source_permission_verified: true,
      imaging_analysis_consent_verified: true,
    },
  })
  expect(conf.ok(), await conf.text()).toBeTruthy()
  const caseId = (await conf.json()).case_id as string
  const an = await request.post(`${API}/cases/${caseId}/analyze`)
  expect(an.ok(), await an.text()).toBeTruthy()
  return caseId
}

test.describe('VHS measurement tool (radiologist workspace)', () => {
  test('six clicks give a VHS value that can be added to the findings', async ({ page, request }) => {
    const caseId = await seedThoraxXrCase(request)
    await loginAsExpert(page)
    await openExpertReviewForCase(page, caseId)

    const viewer = page.getByRole('application', { name: 'DICOM görüntüleyici' })
    const canvas = viewer.locator('canvas').first()
    await expect(canvas).toBeVisible({ timeout: 30_000 })

    await viewer.getByRole('button', { name: /VHS/ }).click()
    // First use explains the tool; plain OK closes it.
    await page.getByRole('dialog', { name: /VHS — Vertebral Kalp Skoru/ }).getByRole('button', { name: 'Tamam' }).click()
    const guide = viewer.getByRole('status').filter({ hasText: /\/6/ })
    await expect(guide).toContainText('1/6')

    await canvas.scrollIntoViewIfNeeded()
    const box = (await canvas.boundingBox())!
    const at = (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy })
    // Long axis (vertical), short axis (horizontal), T4→T8 spine scale.
    const clicks = [at(0.45, 0.3), at(0.45, 0.75), at(0.3, 0.5), at(0.65, 0.5), at(0.15, 0.15), at(0.85, 0.15)]
    for (const [i, p] of clicks.entries()) {
      await canvas.click({ position: p })
      if (i < 5) await expect(guide).toContainText(`${i + 2}/6`)
      if (i === 0) {
        // The drawn mark sits where the user clicked (the overlay used to be stretched sideways).
        const dot = (await viewer.locator('[data-vhs-point="1"]').boundingBox())!
        const fresh = (await canvas.boundingBox())!
        expect(Math.abs(dot.x + dot.width / 2 - (fresh.x + p.x))).toBeLessThan(4)
        expect(Math.abs(dot.y + dot.height / 2 - (fresh.y + p.y))).toBeLessThan(4)
      }
    }

    const result = viewer.getByRole('status').filter({ hasText: /VHS \d+\.\d v/ })
    await expect(result).toBeVisible()
    await expect(result).toContainText(/referans/)

    await result.getByRole('button', { name: 'Rapora ekle' }).click()
    await expect(page.getByText('VHS rapora eklendi')).toBeVisible()
    await expect(page.locator('textarea').filter({ hasText: /VHS \(vertebral kalp skoru\): \d+\.\d v/ }).first()).toBeVisible()

    // Undo removes the last point; the guide is back to step 6.
    await result.getByRole('button', { name: /Geri al/ }).click()
    await expect(guide).toContainText('6/6')
  })

  test('guide pops up on VHS; OK shows it again, "do not show again" hides it, "?" reopens it', async ({ page, request }) => {
    const caseId = await seedThoraxXrCase(request)
    await loginAsExpert(page)
    await openExpertReviewForCase(page, caseId)
    const viewer = page.getByRole('application', { name: 'DICOM görüntüleyici' })
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
    const vhs = viewer.getByRole('button', { name: /VHS/ })
    const dialog = page.getByRole('dialog', { name: /VHS — Vertebral Kalp Skoru/ })

    // Explains what VHS is and how to measure it, with the labelled diagram.
    await vhs.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/kalbin büyüklüğünü ölçmenin standart yöntemi/)).toBeVisible()
    await expect(dialog.getByRole('img', { name: /6 noktanın yerini/ })).toBeVisible()

    // Plain OK → shown again next time.
    await dialog.getByRole('button', { name: 'Tamam' }).click()
    await expect(dialog).toBeHidden()
    await viewer.getByRole('button', { name: /Window \/ Level/ }).click()
    await vhs.click()
    await expect(dialog).toBeVisible()

    // Ticked "don't show again" + OK → not shown on the next VHS click.
    await dialog.getByRole('checkbox', { name: /bir daha gösterme/ }).check()
    await dialog.getByRole('button', { name: 'Tamam' }).click()
    await viewer.getByRole('button', { name: /Window \/ Level/ }).click()
    await vhs.click()
    await expect(viewer.getByRole('status').filter({ hasText: /1\/6/ })).toBeVisible()
    await expect(dialog).toBeHidden()

    // "?" in the strip still opens it.
    await viewer.getByRole('button', { name: 'VHS nasıl ölçülür?' }).click()
    await expect(dialog).toBeVisible()
  })
})
