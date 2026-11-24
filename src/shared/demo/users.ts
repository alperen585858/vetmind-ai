// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.
import type { Role, User } from '../types'

export const USERS: Record<Role, User> = {
  vet: { name: 'Dr. Elif Kaya', title: 'Veteriner Hekim', org: '', initials: 'EK' },
  expert: { name: 'Prof. Dr. Ahmet Demir', title: 'Uzman Veteriner Radyolog', org: 'VRM Teknoloji', initials: 'AD' },
  clinic_owner: { name: 'Klinik Yöneticisi', title: 'Klinik Sahibi', org: '', initials: 'KY' },
  admin: { name: 'Admin', title: 'Sistem Yöneticisi', org: 'VetMind AI', initials: 'SY' },
}

export const ROLE_LABELS: Record<Role, string> = {
  vet: 'Veteriner Hekim',
  expert: 'Uzman Veteriner Radyolog',
  clinic_owner: 'Klinik Sahibi',
  admin: 'Sistem Yöneticisi',
}
