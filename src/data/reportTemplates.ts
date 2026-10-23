import type { ReportSections } from '../types'

export type ReportTemplateId = 'neuro_mr' | 'neuro_ct' | 'thorax_xr' | 'blank'

export const REPORT_TEMPLATES: {
  id: ReportTemplateId
  label: string
  sections: ReportSections
}[] = [
  {
    id: 'blank',
    label: 'Boş şablon',
    sections: {
      klinikOzet: '',
      bulgular: '',
      degerlendirme: '',
      ayiriciTanilar: '',
      oneriler: '',
    },
  },
  {
    id: 'neuro_mr',
    label: 'Nöro MRI iskeleti',
    sections: {
      klinikOzet: 'Multiplanar MR; sekanslar klinik protokole göre. Klinik korelasyon gerekir.',
      bulgular: '—\n\n(Yapılandırılmış bulgular buraya yazılır. AI çıktısı klinik tanı değildir.)',
      degerlendirme: '—\n\nİzlenimler uzman yorumudur; klinik bağlam ile birleştirilmelidir.',
      ayiriciTanilar: '—',
      oneriler: 'Klinik korelasyon; gerekirse ek görüntüleme / takip.',
    },
  },
  {
    id: 'neuro_ct',
    label: 'Nöro CT iskeleti',
    sections: {
      klinikOzet: 'Helikal CT; pencere ayarları klinik protokole göre.',
      bulgular: '—',
      degerlendirme: '—',
      ayiriciTanilar: '—',
      oneriler: 'Klinik korelasyon önerilir.',
    },
  },
  {
    id: 'thorax_xr',
    label: 'Toraks XR iskeleti',
    sections: {
      klinikOzet: 'Toraks radyografisi; projeksiyon klinik protokole göre.',
      bulgular: '—',
      degerlendirme: '—',
      ayiriciTanilar: '—',
      oneriler: 'Klinik korelasyon; gerekirse ek projeksiyon / CT.',
    },
  },
]
