import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '../shell/AppContext'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    info: <Info className="h-5 w-5 text-sky-600" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    error: <XCircle className="h-5 w-5 text-rose-600" />,
  }
  return (
    // Phones: full width inside the screen edges. While the mobile menu drawer is open
    // (Layout sets html[data-drawer=open]) toasts are hidden so they cannot cover it.
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 no-print sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm max-lg:[[data-drawer=open]_&]:hidden">
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
