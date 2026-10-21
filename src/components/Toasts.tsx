import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    info: <Info className="h-5 w-5 text-sky-600" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    error: <XCircle className="h-5 w-5 text-rose-600" />,
  }
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 no-print">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          {icons[t.tone]}
          <div className="flex-1">
            <p className="text-sm font-semibold text-navy-900">{t.title}</p>
            {t.body && <p className="mt-0.5 text-sm text-slate-600">{t.body}</p>}
          </div>
          <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
