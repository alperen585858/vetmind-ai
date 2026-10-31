// English demo AI templates — mirrors src/data/templates.ts (TR default).
import type { AIAssessment, NeuroExam, Patient, ReportSections } from '../types'
import type { TemplateKey } from './templates'
import { TEMPLATES } from './templates'

type TemplateSlice = {
  draft: ReportSections
  summary: string
  imaging: {
    study: string
    findings: string
    conclusion: string
  }
}

const speciesEn = (species: Patient['species']) => (species === 'Köpek' ? 'dog' : 'cat')
const sexEn = (p: Patient) =>
  `${p.neutered ? 'neutered ' : ''}${p.sex === 'Erkek' ? 'male' : 'female'}`
const introEn = (p: Patient) =>
  `${p.name} is a ${p.age}-year-old, ${p.weight} kg ${sexEn(p)} ${p.breed} ${speciesEn(p.species)}.`

const gaitEn = (gait: NeuroExam['gait']) => {
  const m: Record<NeuroExam['gait'], string> = {
    Normal: 'normal gait',
    Parezi: 'paresis',
    Ataksi: 'ataxia',
    Pleji: 'plegia',
  }
  return m[gait] ?? gait.toLowerCase()
}

function mapAiSummary(base: Omit<AIAssessment, 'model' | 'generatedAt'>, summary: string) {
  return { ...base, summary }
}

function enSlice(key: TemplateKey, p: Patient, n: NeuroExam): TemplateSlice {
  switch (key) {
    case 'ivdd':
      return {
        imaging: {
          study: 'Thoracolumbar spine MRI — T2 sagittal, T2 transverse, T1 sagittal, T1 post-contrast',
          findings:
            'At L1–L2, ventral extradural material within the vertebral canal appears hypointense on T2-weighted images. The material compresses the spinal cord left-laterally by approximately 45%. Adjacent T13–L1 and L2–L3 discs show T2 signal loss (degeneration). No marked pathologic contrast enhancement. Vertebral end-plates are regular.',
          conclusion:
            'Ventral, left-lateralized extradural compression at L1–L2. Findings are most consistent with intervertebral disk extrusion.',
        },
        summary: `${introEn(p)} Presented with acute-onset, progressive pelvic limb weakness and thoracolumbar spinal pain. Neurologic exam showed ${gaitEn(n.gait)} in the pelvic limbs, decreased postural reactions, and normal-to-increased spinal reflexes — consistent with T3–L3 myelopathy. MRI describes ventral extradural compression at L1–L2. Signalment (chondrodystrophic breed tendency, middle age), acute onset, spinal hyperesthesia, and imaging together favor Hansen type I intervertebral disk extrusion.`,
        draft: {
          klinikOzet: `${introEn(p)} Presented with acute-onset, progressive pelvic limb weakness and back pain.`,
          bulgular:
            'Neurologic exam: pelvic limb paresis/ataxia, decreased postural reactions, normal-to-increased spinal reflexes. Marked thoracolumbar spinal hyperesthesia. MRI: ventral, left-lateralized extradural compression at L1–L2 (~45%).',
          degerlendirme:
            'Findings are consistent with T3–L3 myelopathy. Signalment, acute onset, and imaging support Hansen type I intervertebral disk extrusion. Worsening within 24 hours was reported.',
          ayiriciTanilar:
            '1. Hansen type I intervertebral disk extrusion (high probability)\n2. Fibrocartilaginous embolism (low)\n3. Spinal neoplasia (low)\n4. Diskospondylitis (low)',
          oneriler:
            'Assess and document deep pain perception. Consider surgical decompression (hemilaminectomy). Preoperative coagulation panel. If conservative care is chosen: strict cage rest and analgesia.',
        },
      }
    case 'seizure':
      return {
        imaging: {
          study: 'Brain MRI — T2 transverse, FLAIR, T1 pre/post-contrast',
          findings:
            'No marked signal abnormality in cerebral or cerebellar parenchyma. Ventricular system symmetric and normal in size. No pathologic contrast enhancement. No midline shift or mass effect.',
          conclusion: 'No imaging evidence of structural intracranial disease.',
        },
        summary: `${introEn(p)} History of recurrent generalized tonic-clonic seizures over the past 3 months. Interictal neurologic exam is normal. Brain MRI shows no structural lesion; metabolic panel within reference range. Findings may fit idiopathic epilepsy, but in cats structural and reactive causes must be carefully excluded.`,
        draft: {
          klinikOzet: `${introEn(p)} Recurrent generalized seizures over the past 3 months.`,
          bulgular:
            'Interictal neurologic exam normal. Brain MRI without structural abnormality. CBC and chemistry within reference range.',
          degerlendirme:
            'Findings are compatible with idiopathic epilepsy; structural and reactive causes largely excluded with current workup.',
          ayiriciTanilar: '1. Idiopathic epilepsy\n2. Structural intracranial disease\n3. Reactive (metabolic/toxic) seizures',
          oneriler:
            'Start antiepileptic therapy (e.g. phenobarbital), recheck serum level at 2 weeks. Seizure diary. CSF analysis may be considered.',
        },
      }
    case 'vestibular':
      return {
        imaging: {
          study: 'Head CT — bone and soft-tissue windows',
          findings:
            'Mild wall thickening of the right tympanic bulla; no soft-tissue density within the bulla. No marked brainstem or cerebellar abnormality.',
          conclusion: 'No marked middle-ear effusion; minimal right bulla wall thickening.',
        },
        summary: `${introEn(p)} Acute head tilt, nystagmus, and vestibular ataxia. Postural reactions and mentation are ${n.consciousness === 'Uyanık' ? 'normal' : 'affected'}; findings favor peripheral vestibular syndrome. Acute onset in a senior dog supports idiopathic vestibular syndrome.`,
        draft: {
          klinikOzet: `${introEn(p)} Acute head tilt, nystagmus, and ataxia.`,
          bulgular:
            'Head tilt, horizontal nystagmus, vestibular ataxia. Postural reactions preserved. CT: minimal right bulla wall thickening.',
          degerlendirme: 'Compatible with peripheral vestibular syndrome; idiopathic vestibular syndrome is leading.',
          ayiriciTanilar:
            '1. Idiopathic vestibular syndrome\n2. Middle-/inner-ear disease\n3. Central vestibular lesion',
          oneriler: 'Supportive care (antiemetic), otoscopic exam, recheck within 72 hours.',
        },
      }
    case 'cervical':
      return {
        imaging: {
          study: 'Cervical spine MRI — T2 sagittal/transverse, T1 post-contrast',
          findings:
            'Ventral extradural material at C2–C3 with mild-to-moderate spinal cord compression. Ventral disk protrusion at C4–C5. No meningeal contrast enhancement.',
          conclusion: 'Ventral extradural compression at C2–C3.',
        },
        summary: `${introEn(p)} Acute neck pain, low head carriage, and reluctance to move the neck. No marked neurologic deficit. MRI shows ventral extradural compression at C2–C3. Cervical intervertebral disk extrusion is the leading consideration.`,
        draft: {
          klinikOzet: `${introEn(p)} Acute-onset neck pain.`,
          bulgular:
            'Marked cervical hyperesthesia, low head posture. No neurologic deficit. MRI: ventral extradural compression at C2–C3.',
          degerlendirme: 'Consistent with cervical intervertebral disk extrusion.',
          ayiriciTanilar:
            '1. Cervical disk extrusion\n2. Steroid-responsive meningitis-arteritis\n3. Vertebral malformation',
          oneriler: 'Cage rest, analgesia; consider ventral slot if pain is uncontrolled.',
        },
      }
    case 'dm':
      return {
        imaging: {
          study: 'Thoracolumbar spine MRI — T2 sagittal/transverse',
          findings:
            'Dorsal annulus protrusion at T13–L1 and L1–L2 with mild cord compression. No marked intramedullary signal change.',
          conclusion: 'Mild multilevel disk protrusion; may not fully explain the clinical picture alone.',
        },
        summary: `${introEn(p)} Months-long, slowly progressive, non-painful pelvic limb ataxia and proprioceptive deficits. MRI shows mild multilevel protrusion that may not fully explain signs. Breed, age, and painless progression suggest degenerative myelopathy.`,
        draft: {
          klinikOzet: `${introEn(p)} Chronic progressive pelvic limb ataxia.`,
          bulgular: 'Non-painful pelvic ataxia and proprioceptive deficits. MRI: mild protrusion at T13–L1 and L1–L2.',
          degerlendirme:
            'Clinical picture fits degenerative myelopathy; MRI alone does not fully explain severity.',
          ayiriciTanilar:
            '1. Degenerative myelopathy\n2. Hansen type II disk protrusion\n3. Spinal neoplasia',
          oneriler: 'SOD1 genetic testing, structured physiotherapy, neurologic recheck every 3 months.',
        },
      }
    case 'forebrain':
      return {
        imaging: {
          study: 'Brain MRI — T2, FLAIR, T1 post-contrast',
          findings:
            'Extra-axial, broad-based, homogeneously contrast-enhancing mass in the left frontal lobe. Dural tail sign present. Mild perilesional edema.',
          conclusion: 'Left frontal extra-axial mass — may be consistent with meningioma.',
        },
        summary: `${introEn(p)} Behavior change and circling. Findings fit prosencephalic localization. Extra-axial mass in a senior cat raises meningioma.`,
        draft: {
          klinikOzet: `${introEn(p)} Behavior change and circling.`,
          bulgular: 'Forebrain signs. MRI: left frontal extra-axial mass.',
          degerlendirme: 'May be consistent with meningioma.',
          ayiriciTanilar: '1. Meningioma\n2. Metabolic encephalopathy\n3. Inflammatory encephalitis',
          oneriler: 'Thoracic radiographs (metastasis screen), surgical consultation.',
        },
      }
  }
}

export const TEMPLATES_EN: Record<TemplateKey, (p: Patient, n: NeuroExam) => ReturnType<(typeof TEMPLATES)[TemplateKey]>> = {
  ivdd: (p, n) => {
    const base = TEMPLATES.ivdd(p, n)
    const en = enSlice('ivdd', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
  seizure: (p, n) => {
    const base = TEMPLATES.seizure(p, n)
    const en = enSlice('seizure', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
  vestibular: (p, n) => {
    const base = TEMPLATES.vestibular(p, n)
    const en = enSlice('vestibular', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
  cervical: (p, n) => {
    const base = TEMPLATES.cervical(p, n)
    const en = enSlice('cervical', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
  dm: (p, n) => {
    const base = TEMPLATES.dm(p, n)
    const en = enSlice('dm', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
  forebrain: (p, n) => {
    const base = TEMPLATES.forebrain(p, n)
    const en = enSlice('forebrain', p, n)
    return {
      ...base,
      imaging: { ...base.imaging, ...en.imaging },
      ai: mapAiSummary(base.ai, en.summary),
      draft: en.draft,
    }
  },
}
