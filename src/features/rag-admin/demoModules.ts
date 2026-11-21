// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.

/** Mock AI module registry cards for the admin Modules screen. */
export const MODULES = [
  { key: 'noroloji', name: 'Nöroloji', status: 'Aktif', docs: 12, cases: 148, model: 'vetmind-neuro-v0.1', desc: 'Spinal, intrakraniyal ve nöromüsküler hastalıklar' },
  { key: 'kardiyoloji', name: 'Kardiyoloji', status: 'Planlanıyor', desc: 'Ekokardiyografi ve EKG raporları' },
  { key: 'onkoloji', name: 'Onkoloji', status: 'Planlanıyor', desc: 'Histopatoloji ve evreleme raporları' },
  { key: 'ortopedi', name: 'Ortopedi', status: 'Planlanıyor', desc: 'Radyografi ve eklem değerlendirmeleri' },
  { key: 'dermatoloji', name: 'Dermatoloji', status: 'Planlanıyor', desc: 'Sitoloji ve deri biyopsisi raporları' },
] as const
