import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CreditCard, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { Button } from './Button'
import { PaymentCardPreview } from './PaymentCardPreview'
import { PaymentSuccessCheck } from './PaymentSuccessCheck'
import { confirmDemoPayment } from '../lib/backend'
import type { BackendDemoPayment, BackendDemoPaymentConfirmResponse } from '../types'

/** Predefined demo card — never send real PAN/CVV in production. */
export const DEMO_TEST_CARD = {
  number: '4242 4242 4242 4242',
  expiry: '12/34',
  cvc: '123',
  name: 'DEMO CARDHOLDER',
} as const

export const DEMO_PRICE_LABEL = '100 EUR'

type PayState = 'idle' | 'loading' | 'success' | 'error'

interface Props {
  payment: BackendDemoPayment
  disabled?: boolean
  onApproved: (result: BackendDemoPaymentConfirmResponse) => void
  /** Fires when the success animation starts (before delayed onApproved). */
  onSuccessStart?: () => void
}

function formatCardNumberInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16)
  return (digits.match(/.{1,4}/g) ?? []).join(' ')
}

function formatExpiryInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

export function DemoPaymentStep({ payment, disabled, onApproved, onSuccessStart }: Props) {
  const [number, setNumber] = useState<string>(DEMO_TEST_CARD.number)
  const [expiry, setExpiry] = useState<string>(DEMO_TEST_CARD.expiry)
  const [cvc, setCvc] = useState<string>(DEMO_TEST_CARD.cvc)
  const [cardholder, setCardholder] = useState<string>(DEMO_TEST_CARD.name)
  const [state, setState] = useState<PayState>('idle')
  const [error, setError] = useState<string | null>(null)
  const successTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (successTimer.current != null) window.clearTimeout(successTimer.current)
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (disabled || state === 'loading' || state === 'success') return
    setState('loading')
    setError(null)
    try {
      // Cardholder name is preview-only — never sent to the backend.
      const result = await confirmDemoPayment(payment.payment_id, {
        card_number: number.replace(/\s+/g, ''),
        expiry: expiry.trim(),
        cvc: cvc.trim(),
      })
      setState('success')
      onSuccessStart?.()
      // Let the green check animation play before parent navigates away.
      successTimer.current = window.setTimeout(() => onApproved(result), 4200)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Demo ödeme başarısız')
    }
  }

  const formLocked = state === 'loading' || state === 'success' || disabled

  if (state === 'success') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 shadow-soft animate-fade-up">
        <PaymentSuccessCheck label="Onaylandı" />
        <p className="mt-4 text-center text-sm text-slate-600">
          Talep radyoloji iş akışına gönderiliyor…
        </p>
        <p className="mt-1 text-center text-xs font-medium text-slate-500">
          {DEMO_PRICE_LABEL} · DEMO / NO REAL CHARGE
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Demo banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800 ring-1 ring-amber-200">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold tracking-wide text-amber-950">DEMO / NO REAL CHARGE</p>
            <p className="text-xs text-amber-900/80">Simüle edilmiş ödeme · gerçek tahsilat veya fatura oluşmaz</p>
          </div>
        </div>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
          Simulated only
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        {/* Left: summary + form */}
        <div className="space-y-5">
          {/* Payment summary */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-soft">
            <div className="border-b border-slate-100 bg-gradient-to-r from-navy-50/80 to-teal-50/40 px-5 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Ödeme özeti</p>
              <p className="mt-0.5 text-base font-semibold text-navy-900">Veteriner görüntüleme talebi</p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-600">Hizmet bedeli</span>
                <span className="text-2xl font-semibold tracking-tight text-navy-900">{DEMO_PRICE_LABEL}</span>
              </div>
              <dl className="grid gap-2 rounded-xl bg-slate-50/90 px-3.5 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Talep türü</dt>
                  <dd className="font-medium text-navy-900">DICOM görüntüleme başvurusu</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Ödeme modu</dt>
                  <dd className="font-medium capitalize text-navy-900">{payment.mode} (simüle)</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Referans</dt>
                  <dd className="truncate font-mono text-xs text-slate-600" title={payment.payment_id}>
                    {payment.payment_id}
                  </dd>
                </div>
              </dl>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" />
                Kart numarası, SKT ve CVC yalnızca doğrulama için kullanılır; saklanmaz ve loglanmaz.
              </p>
            </div>
          </div>

          <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-soft">
              <div>
                <h3 className="text-[15px] font-semibold text-navy-900">Demo kart bilgileri</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Ön tanımlı test kartını kullanın veya alanları düzenleyin — önizleme anında güncellenir.
                </p>
              </div>

              <label className="block">
                <span className="label">Kart üzerindeki isim</span>
                <input
                  className="input mt-1.5"
                  autoComplete="off"
                  value={cardholder}
                  onChange={(e) => setCardholder(e.target.value.slice(0, 32))}
                  disabled={formLocked}
                  placeholder={DEMO_TEST_CARD.name}
                />
                <span className="mt-1 block text-[11px] text-slate-400">Yalnızca önizleme · sunucuya gönderilmez</span>
              </label>

              <label className="block">
                <span className="label">Kart numarası</span>
                <input
                  className="input mt-1.5 font-mono tracking-wider"
                  inputMode="numeric"
                  autoComplete="off"
                  value={number}
                  onChange={(e) => setNumber(formatCardNumberInput(e.target.value))}
                  disabled={formLocked}
                  placeholder={DEMO_TEST_CARD.number}
                />
              </label>

              <div className="grid grid-cols-2 gap-3.5">
                <label className="block">
                  <span className="label">Son kullanma (AA/YY)</span>
                  <input
                    className="input mt-1.5 font-mono tracking-wider"
                    autoComplete="off"
                    inputMode="numeric"
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiryInput(e.target.value))}
                    disabled={formLocked}
                    placeholder={DEMO_TEST_CARD.expiry}
                  />
                </label>
                <label className="block">
                  <span className="label">CVC</span>
                  <input
                    className="input mt-1.5 font-mono tracking-wider"
                    inputMode="numeric"
                    autoComplete="off"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    disabled={formLocked}
                    placeholder={DEMO_TEST_CARD.cvc}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
                <span className="font-medium text-navy-800">Test kartı:</span>{' '}
                <span className="font-mono">{DEMO_TEST_CARD.number}</span> · {DEMO_TEST_CARD.expiry} · CVC{' '}
                {DEMO_TEST_CARD.cvc}
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-950"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <p className="font-semibold">Demo ödeme reddedildi</p>
                    <p className="mt-0.5 text-rose-800/90">{error}</p>
                    <p className="mt-1.5 text-xs text-rose-700/80">
                      Ön tanımlı test kartını deneyin. Başarısız denemeler talebi tamamlamaz.
                    </p>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full shadow-md shadow-teal-700/15"
                disabled={formLocked}
                icon={
                  state === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )
                }
              >
                {state === 'loading' ? 'Demo ödeme doğrulanıyor…' : `Demo öde · ${DEMO_PRICE_LABEL}`}
              </Button>
            </form>
        </div>

        {/* Right: live card preview (stacks above form on small screens via order) */}
        <div className="order-first lg:order-none lg:sticky lg:top-6">
          <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white px-4 py-6 sm:px-6">
            <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Kart önizlemesi
            </p>
            <PaymentCardPreview
              cardNumber={number}
              cardholderName={cardholder}
              expiry={expiry}
              pulsing={state === 'loading'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
