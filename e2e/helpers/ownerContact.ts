/** Required owner fields for case create / DICOM confirm (backend + UI). */
export const E2E_OWNER = {
  owner_name: 'E2E Sahip',
  owner_email: 'owner@demo.local',
  owner_email_consent: true,
  pet_owner_subject: 'owner@demo.local',
} as const

export function withOwnerContact<T extends Record<string, unknown>>(body: T): T & typeof E2E_OWNER {
  return { ...body, ...E2E_OWNER }
}
