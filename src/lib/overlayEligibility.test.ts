import { describe, expect, it } from 'vitest'
import {
  bboxCoordinateTrusted,
  collectOverlayInputsFromFindings,
  eligibleOverlaysForFrame,
  findingOverlayLabel,
} from './overlayEligibility'

describe('overlayEligibility', () => {
  it('labels findings as F1, F2, …', () => {
    expect(findingOverlayLabel(0, 'abc')).toBe('F1')
    expect(findingOverlayLabel(1, 'abc')).toBe('F2')
  })

  it('trusts native coords and model_input only with chain', () => {
    expect(
      bboxCoordinateTrusted({
        x_min: 1,
        y_min: 1,
        x_max: 10,
        y_max: 10,
        coordinate_space: 'pixel_2d_native',
      }),
    ).toBe(true)
    expect(
      bboxCoordinateTrusted({
        x_min: 1,
        y_min: 1,
        x_max: 10,
        y_max: 10,
        coordinate_space: 'model_input',
        transform_chain: [],
      }),
    ).toBe(false)
    expect(
      bboxCoordinateTrusted({
        x_min: 1,
        y_min: 1,
        x_max: 10,
        y_max: 10,
        coordinate_space: 'model_input',
        transform_chain: [{ name: 'resize', params: { sx: 0.5, sy: 0.5 } }],
      }),
    ).toBe(true)
  })

  it('draws multiple verified boxes on the same SOP/frame and skips ungrounded', () => {
    const items = collectOverlayInputsFromFindings([
      {
        finding_id: 'find-a',
        evidence_references: [
          {
            evidence_id: 'e1',
            sop_instance_uid: '1.2.sop',
            frame_index: 0,
            bbox: {
              x_min: 10,
              y_min: 10,
              x_max: 40,
              y_max: 40,
              coordinate_space: 'pixel_2d_native',
            },
            origin: 'ai_proposed',
          },
        ],
      },
      {
        finding_id: 'find-b',
        evidence_references: [
          {
            evidence_id: 'e2',
            sop_instance_uid: '1.2.sop',
            frame_index: 0,
            bbox: {
              x_min: 50,
              y_min: 50,
              x_max: 80,
              y_max: 90,
              coordinate_space: 'pixel_2d_native',
            },
            origin: 'vet_manual',
          },
        ],
      },
      {
        finding_id: 'find-ungrounded',
        evidence_references: [
          {
            evidence_id: 'e3',
            // no SOP
            bbox: {
              x_min: 1,
              y_min: 1,
              x_max: 5,
              y_max: 5,
              coordinate_space: 'pixel_2d_native',
            },
          },
        ],
      },
      {
        finding_id: 'find-wrong-space',
        evidence_references: [
          {
            evidence_id: 'e4',
            sop_instance_uid: '1.2.sop',
            frame_index: 0,
            bbox: {
              x_min: 1,
              y_min: 1,
              x_max: 5,
              y_max: 5,
              coordinate_space: 'patient',
            },
          },
        ],
      },
    ])

    const drawn = eligibleOverlaysForFrame(items, {
      activeSopUid: '1.2.sop',
      activeFrameIndex: 0,
      selectedEvidenceId: 'e2',
      overlaysVisible: true,
    })
    expect(drawn).toHaveLength(2)
    expect(drawn.map((d) => d.label)).toEqual(['F1', 'F2'])
    expect(drawn.find((d) => d.evidenceId === 'e2')?.selected).toBe(true)
    expect(drawn.find((d) => d.evidenceId === 'e1')?.selected).toBe(false)
  })

  it('hides all when overlaysVisible is false', () => {
    const items = collectOverlayInputsFromFindings([
      {
        finding_id: 'find-a',
        evidence_references: [
          {
            evidence_id: 'e1',
            sop_instance_uid: 'sop',
            frame_index: 0,
            bbox: {
              x_min: 1,
              y_min: 1,
              x_max: 2,
              y_max: 2,
              coordinate_space: 'pixel_2d_native',
            },
          },
        ],
      },
    ])
    expect(
      eligibleOverlaysForFrame(items, {
        activeSopUid: 'sop',
        activeFrameIndex: 0,
        selectedEvidenceId: null,
        overlaysVisible: false,
      }),
    ).toEqual([])
  })
})
