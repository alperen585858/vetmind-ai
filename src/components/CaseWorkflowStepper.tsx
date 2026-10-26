import type { FC } from 'react'
import { Check, Circle, CircleX } from 'lucide-react'

const WORKFLOW_STEPS = [
  {
    id: 'dicom',
    label: 'DICOM Yüklendi',
    aliases: ['dicom', 'uploaded', 'dicom_uploaded', 'dicom-yuklendi', 'dicom_yüklendi'],
  },
  {
    id: 'ai',
    label: 'AI İşliyor',
    aliases: ['ai', 'processing', 'ai_processing', 'ai-isliyor', 'ai_işliyor'],
  },
  {
    id: 'expert',
    label: 'Uzman Onayı Bekleniyor',
    aliases: [
      'expert',
      'review',
      'expert_review',
      'awaiting_expert_approval',
      'uzman_incelemesinde',
      'uzman_onayı_bekleniyor',
    ],
  },
  { id: 'report', label: 'Rapor Hazır', aliases: ['report', 'ready', 'report_ready', 'onaylandi', 'rapor_hazır'] },
] as const

type WorkflowStatus = 'error' | 'reject' | 'rejected'

interface CaseWorkflowStepperProps {
  currentStep: string | number
  status?: WorkflowStatus
  className?: string
}

function resolveStepIndex(currentStep: string | number): number | null {
  if (typeof currentStep === 'number') {
    return Number.isInteger(currentStep) && currentStep >= 1 && currentStep <= WORKFLOW_STEPS.length
      ? currentStep - 1
      : null
  }

  const normalizedStep = currentStep.trim().toLowerCase().replace(/\s+/g, '_')
  const numericStep = Number(normalizedStep)
  if (normalizedStep && Number.isInteger(numericStep)) {
    return numericStep >= 1 && numericStep <= WORKFLOW_STEPS.length ? numericStep - 1 : null
  }

  const matchingIndex = WORKFLOW_STEPS.findIndex((step) =>
    step.aliases.some((alias) => alias === normalizedStep),
  )
  return matchingIndex === -1 ? null : matchingIndex
}

export const CaseWorkflowStepper: FC<CaseWorkflowStepperProps> = ({
  currentStep,
  status,
  className = '',
}) => {
  const activeIndex = resolveStepIndex(currentStep)
  const hasError = status === 'error'
  const isRejected = status === 'reject' || status === 'rejected'
  const hasFailure = hasError || isRejected

  return (
    <section
      aria-label="Vaka iş akışı"
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-soft sm:p-5 ${className}`}
    >
      <ol className="flex items-start" aria-label="İlerleme adımları">
        {WORKFLOW_STEPS.map((step, index) => {
          const isComplete = activeIndex !== null && index < activeIndex
          const isActive = activeIndex === index
          const isFailureStep = isActive && hasFailure
          const stepLabel = isFailureStep
            ? `${step.label} — ${isRejected ? 'Reddedildi' : 'Hata'}`
            : step.label

          return (
            <li
              key={step.id}
              className="relative flex min-w-0 flex-1 flex-col items-center text-center"
              aria-current={isActive ? 'step' : undefined}
            >
              {index < WORKFLOW_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-1/2 right-[-50%] top-4 h-0.5 ${
                    isComplete ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                />
              )}
              <span
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white transition-colors ${
                  isFailureStep
                    ? 'bg-vet-red text-white shadow-[0_0_0_3px_rgba(239,68,68,0.18)]'
                    : isComplete
                      ? 'bg-emerald-600 text-white'
                      : isActive
                        ? 'bg-vet-turquoise text-white shadow-[0_0_0_3px_rgba(13,148,136,0.2)]'
                        : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isFailureStep ? (
                  <CircleX aria-hidden="true" className="h-5 w-5" />
                ) : isComplete ? (
                  <Check aria-hidden="true" className="h-5 w-5" />
                ) : (
                  <Circle
                    aria-hidden="true"
                    className={`h-5 w-5 ${isActive ? 'fill-white/20 text-white' : ''}`}
                  />
                )}
              </span>
              <span
                className={`mt-2 max-w-28 px-1 text-xs leading-tight sm:max-w-none sm:text-sm ${
                  isFailureStep
                    ? 'font-semibold text-vet-red'
                    : isActive
                      ? 'font-semibold text-vet-turquoise'
                      : isComplete
                        ? 'font-medium text-slate-700'
                        : 'text-slate-400'
                }`}
              >
                {stepLabel}
              </span>
            </li>
          )
        })}
      </ol>
      {activeIndex === null && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-vet-red">
          İş akışı adımı tanınmadı. `currentStep` değeri 1–4 arasında veya tanımlı bir adım adı olmalıdır.
        </p>
      )}
    </section>
  )
}

export default CaseWorkflowStepper
