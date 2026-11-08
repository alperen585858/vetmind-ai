import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { loginAsExpert } from './auth'
import { openExpertReviewForCase } from './workflow'

const API = process.env.E2E_API_URL || 'http://127.0.0.1:8000/api/v1'

export type SeededAnnotationCase = {
  caseId: string
  findingId: string
  sop: string
  evidenceIds: string[]
}

/** Deterministic mock case + two native bboxes on the same SOP (no Gemini). */
export async function seedAnnotatedCase(
  request: APIRequestContext,
  opts?: { ungrounded?: boolean },
): Promise<SeededAnnotationCase> {
  const up = await request.post(`${API}/dicom/demo/brain_mri`, {
    multipart: {
      patient_name: `E2E-Ann-${Date.now().toString(36)}`,
      species: 'canine',
      clinical_history: 'Synthetic annotation E2E — not a real patient.',
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

  const caseRes = await request.get(`${API}/cases/${caseId}`)
  expect(caseRes.ok()).toBeTruthy()
  const caseBody = await caseRes.json()
  const findingId = caseBody.structured_findings.findings[0].finding_id as string
  const sop =
    (caseBody.model_input?.series?.[0]?.frames?.[0]?.sop_instance_uid as string | undefined) ||
    (caseBody.dicom_study?.series?.[0]?.instances?.[0]?.sop_instance_uid as string | undefined) ||
    ''

  const boxes = [
    { x_min: 20, y_min: 20, x_max: 60, y_max: 70, coordinate_space: 'pixel_2d_native' },
    { x_min: 80, y_min: 40, x_max: 140, y_max: 110, coordinate_space: 'pixel_2d_native' },
  ]
  const evidenceIds: string[] = []
  for (const bbox of boxes) {
    const body: Record<string, unknown> = {
      finding_id: findingId,
      bbox,
      description: 'E2E seeded mark',
    }
    if (sop) {
      body.sop_instance_uid = sop
      body.frame_index = 0
    }
    const add = await request.post(`${API}/cases/${caseId}/evidence`, { data: body })
    expect(add.ok(), await add.text()).toBeTruthy()
    const sf = await add.json()
    const neu = sf.findings
      .flatMap((f: { evidence_references: { evidence_id: string }[] }) => f.evidence_references)
      .find((e: { evidence_id: string }) => e.evidence_id.includes('-vet-') && !evidenceIds.includes(e.evidence_id))
    if (neu) evidenceIds.push(neu.evidence_id)
  }

  if (opts?.ungrounded) {
    const add = await request.post(`${API}/cases/${caseId}/evidence`, {
      data: {
        finding_id: findingId,
        bbox: { x_min: 1, y_min: 1, x_max: 8, y_max: 8, coordinate_space: 'pixel_2d_native' },
        description: 'ungrounded E2E',
        // intentionally no sop_instance_uid
      },
    })
    expect(add.ok(), await add.text()).toBeTruthy()
  }

  return { caseId, findingId, sop, evidenceIds }
}

export async function openAnnotationWorkspace(page: Page, caseId: string) {
  await loginAsExpert(page)
  await openExpertReviewForCase(page, caseId)
  await expect(page.getByText(/F1|Bulgular|AI findings/i).first()).toBeVisible({ timeout: 25_000 })
}

export async function verifyEvidenceViaApi(
  request: APIRequestContext,
  caseId: string,
  evidenceId: string,
) {
  const res = await request.post(`${API}/cases/${caseId}/evidence/${evidenceId}/review`, {
    data: { action: 'verify' },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

export async function exportTraining(request: APIRequestContext, caseId: string) {
  const res = await request.post(`${API}/training/export`, {
    data: {
      dataset_version: 'e2e-ann-1',
      case_ids: [caseId],
      include_splits: false,
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return res.json() as {
    manifest: { row_count: number; export_id: string }
    rows: { evidence_id: string; patient_id: string }[]
  }
}
