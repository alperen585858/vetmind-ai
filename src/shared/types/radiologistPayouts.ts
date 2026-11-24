// Radiologist payout ledger (admin). Owner demo-payment types were removed with pet-owner submissions.
export interface BackendRadiologistPayoutSummary {
  radiologist_subject: string
  display_name?: string | null
  active: boolean
  approved_cases: number
  unpaid_cases: number
  paid_cases: number
  amount_owed: number
  amount_paid: number
  fee_per_case: number
  currency: 'EUR'
}

export interface BackendRadiologistCasePayout {
  payout_id: string
  case_id: string
  radiologist_subject: string
  amount: number
  currency: 'EUR'
  status: 'owed' | 'paid'
  approved_at: string
  paid_at?: string | null
  marked_paid_by?: string | null
  created_at: string
  updated_at: string
}

export interface BackendRadiologistPayoutLedger {
  fee_per_case: number
  currency: 'EUR'
  radiologists: BackendRadiologistPayoutSummary[]
  total_unpaid_cases: number
  total_amount_owed: number
}

export interface BackendRadiologistPayoutDetail {
  summary: BackendRadiologistPayoutSummary
  payouts: BackendRadiologistCasePayout[]
}

export interface BackendRadiologistPayoutSettings {
  fee_per_case: number
  currency: 'EUR'
  updated_at?: string | null
  updated_by?: string | null
}
