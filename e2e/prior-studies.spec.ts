import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginAsVet } from './helpers/auth'

/**
 * Issue #108 — the same animal's earlier study: prior-studies panel, side-by-side viewer,
 * "change since the prior study" report section, and picking the patient in the wizard.
 * Demo mode (auth off): the API is called directly to set up two dated studies.
 */
const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'

async function createPatient(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/patients`, { data: { name, species: 'canine', breed: 'Kangal' } })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).patient_id as string
}

async function brainMriCase(request: APIRequestContext, patientId: string, name: string): Promise<string> {
  const up = await request.post(`${API}/dicom/demo/brain_mri`, {
    multipart: { patient_name: name, species: 'canine', clinical_history: 'Synthetic prior-study E2E.' },
  })
  expect(up.ok(), await up.text()).toBeTruthy()
  const conf = await request.post(`${API}/dicom/ingestions/${(await up.json()).ingest_id}/confirm`, {
    data: {
      accept_suggestion: true,
      imaging_source_permission_verified: true,
      imaging_analysis_consent_verified: true,
      patient_id: patientId,
    },
  })
  expect(conf.ok(), await conf.text()).toBeTruthy()
  const caseId = (await conf.json()).case_id as string
  const an = await request.post(`${API}/cases/${caseId}/analyze`)
  expect(an.ok(), await an.text()).toBeTruthy()
  return caseId
}

test('prior study is listed, compared side by side and summarised in the report', async ({ page, request }) => {
  const name = `Prior-${Date.now().toString(36)}`
  const patientId = await createPatient(request, name)
  const older = await brainMriCase(request, patientId, name)
  const approve = await request.post(`${API}/cases/${older}/review`, {
    data: { reviewer_id: 'expert-demo', action: 'approve' },
  })
  expect(approve.ok(), await approve.text()).toBeTruthy()
  const newer = await brainMriCase(request, patientId, name)

  await loginAsVet(page)
  await page.goto(`/vakalar/${newer}`)
  await expect(page.getByRole('heading', { name: 'Önceki tetkikler' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(name).first()).toBeVisible()
  await expect(page.getByText('Karşılaştırmaya uygun')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Vakayı aç' }).first()).toHaveAttribute('href', new RegExp(older))

  await page.getByRole('button', { name: 'Karşılaştır' }).click()
  const compare = page.getByRole('region', { name: 'Yan yana karşılaştırma' })
  await expect(compare).toBeVisible()
  await expect(compare.getByText('Bu tetkik', { exact: true })).toBeVisible()
  await expect(compare.getByText('Önceki tetkik', { exact: true })).toBeVisible()
  await expect(compare.getByLabel('Senkron kaydır (dilim, zoom)')).toBeChecked()
  await expect(compare.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await compare.getByRole('button', { name: 'Kapat' }).click()
  await expect(compare).toHaveCount(0)

  await page.getByText('Diğer vaka modülleri').click()
  await page.getByRole('button', { name: 'Rapor', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Önceki tetkike göre değişim' })).toBeVisible()
  await expect(page.getByText(/önceki tetkik ile karşılaştırıldı \[P1\]/)).toBeVisible()
})

test('case without a patient offers the matching record and links it', async ({ page, request }) => {
  const name = `Link-${Date.now().toString(36)}`
  await createPatient(request, name)
  const up = await request.post(`${API}/cases`, {
    data: {
      patient_name: name,
      species: 'canine',
      modality: 'MR',
      anatomical_region: 'BRAIN',
      scenario: 'brain_mri_suspected',
      clinical_history: 'Synthetic link E2E.',
    },
  })
  expect(up.ok(), await up.text()).toBeTruthy()
  const caseId = (await up.json()).case_id as string

  await loginAsVet(page)
  await page.goto(`/vakalar/${caseId}`)
  await expect(page.getByText('henüz bir hasta kaydına bağlı değil')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(`${name} (Köpek) adında kayıtlı hasta var`)).toBeVisible()
  await page.getByRole('button', { name: 'Bağla', exact: true }).click()
  await expect(page.getByText('Bu hastanın başka tetkiki yok.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bağlantıyı kaldır' })).toBeVisible()
})

test('new-case wizard finds a registered patient and fills the form', async ({ page, request }) => {
  const name = `Wiz-${Date.now().toString(36)}`
  await createPatient(request, name)
  await loginAsVet(page)
  await page.goto('/vakalar/yeni')
  await page.getByLabel('Kayıtlı hasta ara').fill(name)
  await page.getByRole('button', { name: `${name} hastasını seç` }).click()
  await expect(page.getByText(`Kayıtlı hasta: ${name}`)).toBeVisible()
  await expect(page.getByPlaceholder('ör. Paşa')).toHaveValue(name)
  await page.getByRole('button', { name: 'Bağlantıyı kaldır' }).click()
  await expect(page.getByLabel('Kayıtlı hasta ara')).toBeVisible()
})
