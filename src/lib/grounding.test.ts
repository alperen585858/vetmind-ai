import { describe, expect, it } from 'vitest'
import { parseWarning, parseWarnings, splitCitations } from './grounding'

describe('parseWarning', () => {
  it('maps backend grounding warnings to Turkish categories', () => {
    expect(parseWarning('Grounding: 2 uncited statement(s) in impression: "A"; "B".')).toMatchObject({
      kind: 'uncited',
      title: '2 kaynaksız ifade',
      section: 'Değerlendirme',
      detail: '"A"; "B"',
    })
    expect(
      parseWarning('Grounding: findings cites unknown reference(s) S4, F9 — not in the findings/passages given to the model.'),
    ).toMatchObject({ kind: 'unknown_ref', section: 'Bulgular', detail: 'S4, F9 modele verilen bulgu/kaynak listesinde yok.' })
    expect(
      parseWarning('Grounding: impression contains a definitive diagnosis statement ("Kesin tanı"); drafts must keep findings hedged.'),
    ).toMatchObject({ kind: 'overclaim', title: 'Kesin tanı ifadesi', section: 'Değerlendirme' })
    expect(parseWarning('Grounding: imaging finding(s) not mentioned in the draft: F2 (find-2).')).toMatchObject({
      kind: 'omitted',
      detail: 'F2 (find-2)',
    })
    expect(parseWarning('Structured findings originated from a MOCK imaging adapter.').kind).toBe('system')
  })

  it('sorts the most serious issues first', () => {
    const kinds = parseWarnings([
      'Report source is MOCK.',
      'Grounding: imaging finding(s) not mentioned in the draft: F2 (x).',
      'Grounding: impression contains a certainty statement ("kesinlikle"); drafts must keep findings hedged.',
    ]).map((w) => w.kind)
    expect(kinds).toEqual(['overclaim', 'omitted', 'system'])
  })
})

describe('splitCitations', () => {
  it('splits text and grouped markers', () => {
    expect(splitCitations('Kitle [F1]. Meningiom olası [F1, S2].')).toEqual([
      { type: 'text', value: 'Kitle ' },
      { type: 'cite', aliases: ['F1'] },
      { type: 'text', value: '. Meningiom olası ' },
      { type: 'cite', aliases: ['F1', 'S2'] },
      { type: 'text', value: '.' },
    ])
    expect(splitCitations('Atıf yok [X1].')).toEqual([{ type: 'text', value: 'Atıf yok [X1].' }])
  })
})
