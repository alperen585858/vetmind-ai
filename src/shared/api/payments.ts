import { request } from './client'

export async function createDemoPaymentIntent(submissionId: string) {
  return request<import('../../types').BackendDemoPayment>('/payments/intents', {
    method: 'POST',
    body: JSON.stringify({ submission_id: submissionId }),
  })
}

export async function getDemoPayment(paymentId: string) {
  return request<import('../../types').BackendDemoPayment>(`/payments/intents/${paymentId}`)
}

export async function getDemoPaymentBySubmission(submissionId: string) {
  return request<import('../../types').BackendDemoPayment>(`/payments/by-submission/${submissionId}`)
}

export async function confirmDemoPayment(
  paymentId: string,
  payload: { card_number: string; expiry: string; cvc: string },
) {
  return request<import('../../types').BackendDemoPaymentConfirmResponse>(
    `/payments/intents/${paymentId}/confirm-demo`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}
