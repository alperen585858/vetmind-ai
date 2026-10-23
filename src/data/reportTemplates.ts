import type { ReportSections } from '../types'

export type ReportTemplateId = 'neuro_mr' | 'neuro_ct' | 'thorax_xr' | 'blank'

/** Professional radiology skeletons — headings only; no fabricated clinical findings. */
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
    label: 'Nöro MRI — yapılandırılmış rapor',
    sections: {
      klinikOzet:
        'TEKNİK\n' +
        'Multiplanar MR; sekanslar klinik protokole göre kaydedilir.\n' +
        'Kontrast: [uygulandı / uygulanmadı]\n' +
        'Klinik endikasyon: [serbest metin]\n\n' +
        'Not: Şablon iskeletidir; AI çıktısı klinik tanı değildir.',
      bulgular:
        'BULGULAR (Findings)\n' +
        '— Beyin parankimi:\n' +
        '— Ventriküler sistem / ekstraksiyel boşluklar:\n' +
        '— Kraniyal sinirler / meninksler:\n' +
        '— Servikal / ilgili omurga (varsa):\n' +
        '— Diğer:',
      degerlendirme:
        'YORUM / İZLENİM (Interpretation & Impression)\n' +
        '1. [Birincil izlenim — uzman yazar]\n' +
        '2. [İkincil / sınırlı bulgular]\n\n' +
        'Klinik korelasyon zorunludur.',
      ayiriciTanilar: '',
      oneriler:
        'ÖNERİLER (Recommendations)\n' +
        '— Klinik korelasyon\n' +
        '— Gerekirse ek sekans / kontrast / takip görüntüleme\n' +
        '— Klinik hekim ile vaka tartışması (isteğe bağlı)',
    },
  },
  {
    id: 'neuro_ct',
    label: 'Nöro CT — yapılandırılmış rapor',
    sections: {
      klinikOzet:
        'TEKNİK\n' +
        'Helikal CT; pencere ayarları klinik protokole göre.\n' +
        'Kontrast: [uygulandı / uygulanmadı]\n' +
        'Klinik endikasyon: [serbest metin]',
      bulgular:
        'BULGULAR (Findings)\n' +
        '— Parankim / densite:\n' +
        '— Kemik / sinüsler / bulla:\n' +
        '— Kanama / kitle etkisi (varsa tanımlayın):\n' +
        '— Diğer:',
      degerlendirme:
        'YORUM / İZLENİM (Interpretation & Impression)\n' +
        '1. [Birincil izlenim]\n' +
        '2. [Sınırlılıklar — CT çözünürlüğü / artefakt]\n\n' +
        'Klinik korelasyon zorunludur.',
      ayiriciTanilar: '',
      oneriler:
        'ÖNERİLER (Recommendations)\n' +
        '— Klinik korelasyon\n' +
        '— Gerekirse MR ile tamamlayıcı değerlendirme\n' +
        '— Acil klinik yönetim klinik hekimin sorumluluğundadır',
    },
  },
  {
    id: 'thorax_xr',
    label: 'Toraks XR — yapılandırılmış rapor',
    sections: {
      klinikOzet:
        'TEKNİK\n' +
        'Toraks radyografisi; projeksiyon(lar): [VD/DV / lateral].\n' +
        'Klinik endikasyon: [serbest metin]',
      bulgular:
        'BULGULAR (Findings)\n' +
        '— Kardiyak siluet / vaskülarizasyon:\n' +
        '— Pulmoner parankim / plevra:\n' +
        '— Mediasten / hilus:\n' +
        '— Diyafram / ekstra-torasik yapılar:\n' +
        '— Diğer:',
      degerlendirme:
        'YORUM / İZLENİM (Interpretation & Impression)\n' +
        '1. [Birincil izlenim]\n' +
        '2. [Teknik sınırlılıklar]\n\n' +
        'Klinik korelasyon zorunludur.',
      ayiriciTanilar: '',
      oneriler:
        'ÖNERİLER (Recommendations)\n' +
        '— Klinik korelasyon\n' +
        '— Gerekirse ek projeksiyon / toraks CT\n' +
        '— Takip görüntüleme endikasyonu klinik karara bağlıdır',
    },
  },
]
