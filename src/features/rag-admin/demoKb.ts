// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.
import type { Locale } from '../../i18n/types'
import type { KbSource } from '../../shared/types'

export function kbSourceText(s: KbSource, locale: Locale) {
  if (locale === 'en') {
    return {
      title: s.titleEn ?? s.title,
      section: s.sectionEn ?? s.section,
      passage: s.passageEn ?? s.passage,
    }
  }
  return { title: s.title, section: s.section, passage: s.passage }
}

const KB_TYPE_EN: Record<KbSource['type'], string> = {
  Kitap: 'Book',
  'Bilimsel yayın': 'Journal article',
  'VRM örnek rapor': 'VRM sample report',
}

const KB_LICENSE_EN: Record<KbSource['license'], string> = {
  İzinli: 'Licensed',
  Beklemede: 'Pending',
}

export function kbTypeLabel(type: KbSource['type'], locale: Locale) {
  return locale === 'en' ? KB_TYPE_EN[type] : type
}

export function kbLicenseLabel(license: KbSource['license'], locale: Locale) {
  return locale === 'en' ? KB_LICENSE_EN[license] : license
}

/** Seed KB sources with optional English fields applied (custom RAG docs unchanged). */
export function getKbSources(locale: Locale, sources: KbSource[] = KB_SOURCES): KbSource[] {
  if (locale === 'tr') return sources
  return sources.map((s) => {
    const text = kbSourceText(s, locale)
    return { ...s, title: text.title, section: text.section, passage: text.passage }
  })
}

export const KB_SOURCES: KbSource[] = [
  {
    id: 1,
    title: 'Veteriner Nöroloji Ders Kitabı (örnek)',
    titleEn: 'Veterinary Neurology Textbook (sample)',
    type: 'Kitap',
    section: 'Bölüm 7 — Torakolomber Miyelopatiler',
    sectionEn: 'Chapter 7 — Thoracolumbar myelopathies',
    license: 'İzinli',
    chunks: 1240,
    indexedAt: '2026-09-02',
    keywords: ['disk', 'ivdd', 'hansen', 't3-l3', 'kondrodistrofik', 'dachshund', 'miyelopati', 'parezi', 'refleks'],
    passage:
      'Kondrodistrofik ırklarda (ör. Dachshund) nükleus pulpozusun erken kondroid dejenerasyonu, genellikle 3–7 yaş arasında akut Hansen tip I disk ekstrüzyonlarına zemin hazırlar. T3-L3 lezyonlarında pelvik ekstremitelerde üst motor nöron bulguları (normal-artmış spinal refleksler) ile birlikte parezi veya pleji beklenir.',
    passageEn:
      'In chondrodystrophic breeds (e.g. Dachshund), early chondroid degeneration of the nucleus pulposus predisposes to acute Hansen type I disk extrusions, often between 3–7 years. T3–L3 lesions typically show upper motor neuron signs in the pelvic limbs (normal-to-increased spinal reflexes) with paresis or plegia.',
  },
  {
    id: 2,
    title: 'Spinal Hastalıklar Derlemesi (örnek)',
    titleEn: 'Spinal Disease Review (sample)',
    type: 'Bilimsel yayın',
    section: 'İntervertebral disk hastalığının sınıflandırılması',
    sectionEn: 'Classification of intervertebral disk disease',
    license: 'İzinli',
    chunks: 386,
    indexedAt: '2026-09-04',
    keywords: ['disk', 'ekstrüzyon', 'protrüzyon', 'hansen', 'hiperestezi', 'ağrı', 'tip ii'],
    passage:
      'Akut disk ekstrüzyonu vakalarının büyük bölümünde belirgin spinal hiperestezi gözlenir. Hansen tip II protrüzyonlar ise daha yavaş, kronik ve çoğunlukla daha hafif ağrılı bir klinik seyir gösterir.',
    passageEn:
      'Most acute disk extrusion cases show marked spinal hyperesthesia. Hansen type II protrusions tend to have a slower, chronic course and are often less painful clinically.',
  },
  {
    id: 3,
    title: 'VRM Örnek MR Raporları Seti',
    titleEn: 'VRM Sample MRI Report Set',
    type: 'VRM örnek rapor',
    section: 'Rapor #MR-0142 (anonimleştirilmiş, örnek)',
    sectionEn: 'Report #MR-0142 (anonymized sample)',
    license: 'İzinli',
    chunks: 920,
    indexedAt: '2026-09-18',
    keywords: ['mr', 'kompresyon', 'ekstradural', 'ventral', 'l1-l2', 't2', 'görüntüleme'],
    passage:
      'L1-L2 disk aralığı seviyesinde ventral yerleşimli, T2 ağırlıklı serilerde hipointens ekstradural materyal; spinal kordda sola lateralize kompresyon. Bulgular disk ekstrüzyonu ile uyumludur. (Örnek rapor dilini göstermek amacıyla anonimleştirilmiştir.)',
    passageEn:
      'Ventrally located hypointense extradural material on T2-weighted sequences at L1–L2 with left-lateral cord compression. Findings are consistent with disk extrusion. (Anonymized sample report language.)',
  },
  {
    id: 4,
    title: 'Fibrokartilaginöz Emboli Vaka Serisi (örnek)',
    titleEn: 'Fibrocartilaginous Embolism Case Series (sample)',
    type: 'Bilimsel yayın',
    section: 'Klinik bulgular',
    sectionEn: 'Clinical findings',
    license: 'İzinli',
    chunks: 142,
    indexedAt: '2026-09-05',
    keywords: ['fke', 'emboli', 'iskemik', 'ağrısız', 'akut', 'lateralize'],
    passage:
      'Fibrokartilaginöz emboli tipik olarak perakut başlangıçlı, ağrısız ve çoğunlukla lateralize nörolojik defisit ile karakterizedir. İlk 24 saatten sonra kötüleşme beklenmez; belirgin spinal hiperestezi ayırıcı tanıda ekstrüzyon lehinedir.',
    passageEn:
      'Fibrocartilaginous embolism is typically peracute, non-painful, and often lateralized. Decline after the first 24 hours is unexpected; marked spinal hyperesthesia favors extrusion in the differential.',
  },
  {
    id: 5,
    title: 'Spinal ve İntrakraniyal Neoplaziler Atlası (örnek)',
    titleEn: 'Spinal and Intracranial Neoplasia Atlas (sample)',
    type: 'Kitap',
    section: 'Ekstradural ve ekstraaksiyel kitleler',
    sectionEn: 'Extradural and extra-axial masses',
    license: 'İzinli',
    chunks: 610,
    indexedAt: '2026-09-07',
    keywords: ['neoplazi', 'tümör', 'menenjiyom', 'kitle', 'kontrast', 'dural kuyruk'],
    passage:
      'Spinal neoplaziler çoğunlukla ileri yaşta, kronik progresif seyirle ortaya çıkar. Kontrast tutulumu ve kemik değişiklikleri neoplazi lehine değerlendirilir. İntrakraniyal menenjiyom, yaşlı kedilerde en sık primer beyin tümörüdür; dural kuyruk işareti destekleyicidir.',
    passageEn:
      'Spinal neoplasia usually presents in older patients with chronic progression. Contrast enhancement and bone changes favor neoplasia. Intracranial meningioma is the most common primary brain tumor in senior cats; a dural tail sign is supportive.',
  },
  {
    id: 6,
    title: 'Diskospondilit Klinik Notları (örnek)',
    titleEn: 'Diskospondylitis Clinical Notes (sample)',
    type: 'Bilimsel yayın',
    section: 'Tanı yaklaşımı',
    sectionEn: 'Diagnostic approach',
    license: 'İzinli',
    chunks: 98,
    indexedAt: '2026-09-07',
    keywords: ['diskospondilit', 'enfeksiyon', 'ateş', 'end-plate', 'lökosit'],
    passage:
      'Diskospondilit vakalarında spinal ağrıya sıklıkla ateş, lökositoz ve görüntülemede vertebral end-plate erozyonu eşlik eder. Normal end-plate morfolojisi tanıyı olası kılmaz.',
    passageEn:
      'Diskospondylitis often presents with spinal pain plus fever, leukocytosis, and vertebral end-plate erosion on imaging. Normal end-plate morphology does not rule out the diagnosis.',
  },
  {
    id: 7,
    title: 'Kedi ve Köpekte Nöbet Yönetimi (örnek)',
    titleEn: 'Seizure Management in Dogs and Cats (sample)',
    type: 'Kitap',
    section: 'Bölüm 3 — Nöbetlerin sınıflandırılması',
    sectionEn: 'Chapter 3 — Classification of seizures',
    license: 'İzinli',
    chunks: 540,
    indexedAt: '2026-09-10',
    keywords: ['nöbet', 'epilepsi', 'idiyopatik', 'reaktif', 'yapısal', 'kedi', 'fenobarbital'],
    passage:
      'Kedilerde nöbetlerin önemli bir bölümü yapısal intrakraniyal hastalıklara bağlıdır; bu nedenle idiyopatik epilepsi tanısı ancak normal interiktal muayene, normal MR ve metabolik nedenlerin dışlanmasından sonra konmalıdır.',
    passageEn:
      'A substantial proportion of seizures in cats are due to structural intracranial disease; idiopathic epilepsy should be diagnosed only after normal interictal exam, normal MRI, and exclusion of metabolic causes.',
  },
  {
    id: 8,
    title: 'Vestibüler Hastalıklar Derlemesi (örnek)',
    titleEn: 'Vestibular Disease Review (sample)',
    type: 'Bilimsel yayın',
    section: 'Periferik ve merkezi vestibüler sendrom',
    sectionEn: 'Peripheral vs central vestibular syndrome',
    license: 'İzinli',
    chunks: 210,
    indexedAt: '2026-09-12',
    keywords: ['vestibüler', 'nistagmus', 'baş eğikliği', 'otitis', 'periferik', 'merkezi'],
    passage:
      'Postüral reaksiyonların ve bilinç durumunun korunması periferik vestibüler sendromu destekler. Yaşlı köpeklerde akut başlangıçlı idiyopatik vestibüler sendrom sıklıkla 72 saat içinde belirgin düzelme gösterir.',
    passageEn:
      'Preserved postural reactions and mentation support peripheral vestibular syndrome. Idiopathic vestibular syndrome in senior dogs often improves markedly within 72 hours of acute onset.',
  },
  {
    id: 9,
    title: 'Nörolojik Muayene Rehberi (örnek)',
    titleEn: 'Neurologic Examination Guide (sample)',
    type: 'Kitap',
    section: 'Ağrı algısı ve postüral reaksiyonlar',
    sectionEn: 'Pain perception and postural reactions',
    license: 'İzinli',
    chunks: 330,
    indexedAt: '2026-09-01',
    keywords: ['muayene', 'derin ağrı', 'postüral', 'refleks', 'propriyosepsiyon', 'kraniyal sinir'],
    passage:
      'Pleji veya ağır parezi bulunan hastalarda derin ağrı algısının değerlendirilmesi, prognozu belirleyen en önemli muayene bulgusudur ve her vakada kayıt altına alınmalıdır.',
    passageEn:
      'In patients with plecia or severe paresis, assessment of deep pain perception is among the most prognostically important exam findings and should be documented in every case.',
  },
  {
    id: 10,
    title: 'Servikal Spinal Hastalıklar (örnek)',
    titleEn: 'Cervical Spinal Disorders (sample)',
    type: 'Bilimsel yayın',
    section: 'Boyun ağrısının ayırıcı tanısı',
    sectionEn: 'Differential diagnosis of neck pain',
    license: 'Beklemede',
    chunks: 176,
    indexedAt: '2026-10-01',
    keywords: ['servikal', 'boyun', 'menenjit', 'srma', 'c1-c5', 'bulldog'],
    passage:
      'Genç köpeklerde boyun ağrısının ayırıcı tanısında servikal disk hastalığı ile birlikte steroid yanıtlı menenjit-arterit mutlaka değerlendirilmelidir; ateş ve BOS bulguları ayrımda yol göstericidir.',
    passageEn:
      'Neck pain in young dogs requires consideration of cervical disk disease and steroid-responsive meningitis-arteritis; fever and CSF findings guide the distinction.',
  },
  {
    id: 11,
    title: 'VRM Örnek BT Raporları Seti',
    titleEn: 'VRM Sample CT Report Set',
    type: 'VRM örnek rapor',
    section: 'Kafa BT örnekleri',
    sectionEn: 'Head CT samples',
    license: 'İzinli',
    chunks: 264,
    indexedAt: '2026-09-20',
    keywords: ['bt', 'bulla', 'orta kulak', 'tomografi'],
    passage:
      'Timpanik bulla duvar kalınlaşması ve bulla içi yumuşak doku dansitesi orta kulak hastalığını destekler. (Örnek rapor, anonimleştirilmiş.)',
    passageEn:
      'Tympanic bulla wall thickening and intrabulla soft-tissue density support middle-ear disease. (Anonymized sample report.)',
  },
  {
    id: 12,
    title: 'Dejeneratif Miyelopati İncelemesi (örnek)',
    titleEn: 'Degenerative Myelopathy Review (sample)',
    type: 'Bilimsel yayın',
    section: 'Klinik seyir',
    sectionEn: 'Clinical course',
    license: 'Beklemede',
    chunks: 118,
    indexedAt: '2026-10-03',
    keywords: ['dejeneratif', 'miyelopati', 'sod1', 'alman kurdu', 'kronik', 'ataksi'],
    passage:
      'Dejeneratif miyelopati, ileri yaşta, ağrısız ve yavaş progresif pelvik ataksi ile karakterizedir. SOD1 mutasyonu destekleyicidir; kesin tanı histopatolojiktir.',
    passageEn:
      'Degenerative myelopathy presents in older dogs as non-painful, slowly progressive pelvic ataxia. SOD1 mutation is supportive; definitive diagnosis is histopathologic.',
  },
]
