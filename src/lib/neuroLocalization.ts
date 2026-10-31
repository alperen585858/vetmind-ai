import type { ClinicalInfo, NeuroExam } from '../types'
import type { TemplateKey } from '../data/templates'
import type { Locale } from '../i18n/types'

export interface LocalizationHint {
  region: string
  text: string
  template: TemplateKey
}

const PELVIC = ['Sol arka', 'Sağ arka']
const THORACIC = ['Sol ön', 'Sağ ön']

const VESTIBULAR_SIGNS = ['Baş eğikliği', 'Nistagmus']

// Mock neuroanatomic localization — demo only.
export function localize(n: NeuroExam, c?: ClinicalInfo, locale: Locale = 'tr'): LocalizationHint | null {
  const complaint = (c?.complaint ?? '').toLocaleLowerCase('tr')
  const vestibular = n.cranialNerves.some((x) => VESTIBULAR_SIGNS.includes(x))

  if (vestibular) {
    return locale === 'en'
      ? {
          region: 'Vestibular system',
          text: 'May be consistent with vestibular system lesion (assess mentation and postural reactions to distinguish peripheral vs central).',
          template: 'vestibular',
        }
      : {
          region: 'Vestibüler sistem',
          text: 'Vestibüler sistem lezyonu ile uyumlu olabilir (periferik/merkezi ayrımı için bilinç ve postüral reaksiyonları değerlendirin).',
          template: 'vestibular',
        }
  }
  if (n.consciousness !== 'Uyanık' || complaint.includes('nöbet') || complaint.includes('davranış')) {
    const seizure = complaint.includes('nöbet')
    return locale === 'en'
      ? {
          region: 'Forebrain (prosencephalon)',
          text: 'May be consistent with prosencephalic (forebrain) lesion.',
          template: seizure ? 'seizure' : 'forebrain',
        }
      : {
          region: 'Prosensefalon',
          text: 'Prosensefalon (ön beyin) lezyonu ile uyumlu olabilir.',
          template: seizure ? 'seizure' : 'forebrain',
        }
  }

  const hasPelvic = n.limbs.some((l) => PELVIC.includes(l))
  const hasThoracic = n.limbs.some((l) => THORACIC.includes(l))

  if (n.gait !== 'Normal' && hasPelvic && !hasThoracic) {
    if (n.reflexPelvic === 'Azalmış') {
      return locale === 'en'
        ? {
            region: 'L4–S3',
            text: 'May be consistent with L4–S3 myelopathy (lower motor neuron signs in pelvic limbs).',
            template: 'ivdd',
          }
        : {
            region: 'L4-S3',
            text: 'L4-S3 miyelopati ile uyumlu olabilir (pelvik ekstremitelerde alt motor nöron bulguları).',
            template: 'ivdd',
          }
    }
    const chronic = c?.onset === 'Kronik' && n.hyperesthesia === 'Yok'
    const hyperesthesiaNote =
      n.hyperesthesia === 'Torakolomber'
        ? locale === 'en'
          ? ' (thoracolumbar hyperesthesia supports a lesion in this region)'
          : ' (torakolomber hiperestezi lezyonun bu bölgede olduğunu destekler)'
        : ''
    return locale === 'en'
      ? {
          region: 'T3–L3',
          text: `May be consistent with T3–L3 myelopathy${hyperesthesiaNote}.`,
          template: chronic ? 'dm' : 'ivdd',
        }
      : {
          region: 'T3-L3',
          text: `T3-L3 miyelopati ile uyumlu olabilir${hyperesthesiaNote}.`,
          template: chronic ? 'dm' : 'ivdd',
        }
  }
  if (n.gait !== 'Normal' && hasThoracic) {
    if (n.reflexThoracic === 'Azalmış') {
      return locale === 'en'
        ? {
            region: 'C6–T2',
            text: 'May be consistent with C6–T2 myelopathy (lower motor neuron signs in thoracic limbs).',
            template: 'cervical',
          }
        : {
            region: 'C6-T2',
            text: 'C6-T2 miyelopati ile uyumlu olabilir (torasik ekstremitelerde alt motor nöron bulguları).',
            template: 'cervical',
          }
    }
    return locale === 'en'
      ? { region: 'C1–C5', text: 'May be consistent with C1–C5 myelopathy.', template: 'cervical' }
      : { region: 'C1-C5', text: 'C1-C5 miyelopati ile uyumlu olabilir.', template: 'cervical' }
  }
  if (n.hyperesthesia === 'Servikal') {
    return locale === 'en'
      ? {
          region: 'Cervical',
          text: 'Cervical pain — assess reflexes to distinguish C1–C5 vs C6–T2.',
          template: 'cervical',
        }
      : {
          region: 'Servikal',
          text: 'Servikal bölge ağrısı — C1-C5 / C6-T2 ayrımı için refleksleri değerlendirin.',
          template: 'cervical',
        }
  }
  if (n.hyperesthesia === 'Torakolomber') {
    return locale === 'en'
      ? {
          region: 'T3–L3',
          text: 'Thoracolumbar hyperesthesia — may be consistent with T3–L3 region.',
          template: 'ivdd',
        }
      : {
          region: 'T3-L3',
          text: 'Torakolomber hiperestezi — T3-L3 bölgesi ile uyumlu olabilir.',
          template: 'ivdd',
        }
  }
  return null
}
