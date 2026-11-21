import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'success' | 'info' | 'warning' | 'error'
}

type ToastContextValue = {
  toasts: Toast[]
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
}

const Ctx = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((all) => [...all.slice(-2), { ...t, id }])
      setTimeout(() => dismissToast(id), 3500)
    },
    [dismissToast],
  )

  const value = useMemo<ToastContextValue>(() => ({ toasts, pushToast, dismissToast }), [toasts, pushToast, dismissToast])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useToasts() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToasts, ToastProvider içinde kullanılmalı')
  return v
}
