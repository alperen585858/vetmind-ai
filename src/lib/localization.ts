import type { ClinicalInfo, NeuroExam } from '../types'
import type { TemplateKey } from '../data/templates'

export interface LocalizationHint {
  region: string
  text: string
  template: TemplateKey
}

const PELVIC = ['Sol arka', 'Sağ arka']
const THORACIC = ['Sol ön', 'Sağ ön']

// Mock nöroanatomik lokalizasyon mantığı — yalnızca demo amaçlıdır.
export function localize(n: NeuroExam, c?: ClinicalInfo): LocalizationHint | null {
  const complaint = (c?.complaint ?? '').toLocaleLowerCase('tr')
  const vestibular = n.cranialNerves.some((x) => x === 'Baş eğikliği' || x === 'Nistagmus')

  if (vestibular) {
    return { region: 'Vestibüler sistem', text: 'Vestibüler sistem lezyonu ile uyumlu olabilir (periferik/merkezi ayrımı için bilinç ve postüral reaksiyonları değerlendirin).', template: 'vestibular' }
  }
  if (n.consciousness !== 'Uyanık' || complaint.includes('nöbet') || complaint.includes('davranış')) {
    const seizure = complaint.includes('nöbet')
    return { region: 'Prosensefalon', text: 'Prosensefalon (ön beyin) lezyonu ile uyumlu olabilir.', template: seizure ? 'seizure' : 'forebrain' }
  }

  const hasPelvic = n.limbs.some((l) => PELVIC.includes(l))
  const hasThoracic = n.limbs.some((l) => THORACIC.includes(l))

  if (n.gait !== 'Normal' && hasPelvic && !hasThoracic) {
    if (n.reflexPelvic === 'Azalmış') {
      return { region: 'L4-S3', text: 'L4-S3 miyelopati ile uyumlu olabilir (pelvik ekstremitelerde alt motor nöron bulguları).', template: 'ivdd' }
    }
    const chronic = c?.onset === 'Kronik' && n.hyperesthesia === 'Yok'
    return {
      region: 'T3-L3',
      text: `T3-L3 miyelopati ile uyumlu olabilir${n.hyperesthesia === 'Torakolomber' ? ' (torakolomber hiperestezi lezyonun bu bölgede olduğunu destekler)' : ''}.`,
      template: chronic ? 'dm' : 'ivdd',
    }
  }
  if (n.gait !== 'Normal' && hasThoracic) {
    if (n.reflexThoracic === 'Azalmış') {
      return { region: 'C6-T2', text: 'C6-T2 miyelopati ile uyumlu olabilir (torasik ekstremitelerde alt motor nöron bulguları).', template: 'cervical' }
    }
    return { region: 'C1-C5', text: 'C1-C5 miyelopati ile uyumlu olabilir.', template: 'cervical' }
  }
  if (n.hyperesthesia === 'Servikal') {
    return { region: 'Servikal', text: 'Servikal bölge ağrısı — C1-C5 / C6-T2 ayrımı için refleksleri değerlendirin.', template: 'cervical' }
  }
  if (n.hyperesthesia === 'Torakolomber') {
    return { region: 'T3-L3', text: 'Torakolomber hiperestezi — T3-L3 bölgesi ile uyumlu olabilir.', template: 'ivdd' }
  }
  return null
}
