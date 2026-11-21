export type Role = 'vet' | 'expert' | 'owner' | 'clinic_owner' | 'admin'

export interface User {
  name: string
  title: string
  org: string
  initials: string
  /** Demo / backend subject (e.g. owner@demo.local) when known. */
  email?: string
}
