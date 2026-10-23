import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../lib/backend'
import { fmtDate } from '../lib/format'

export function NotificationBell() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    void listNotifications()
      .then((res) => {
        setItems(res.items)
        setUnread(res.unread_count)
      })
      .catch(() => {
        setItems([])
        setUnread(0)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 30000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const onOpen = () => {
    setOpen((o) => !o)
    if (!open) refresh()
  }

  const onClickItem = async (n: AppNotification) => {
    try {
      if (!n.read_at) await markNotificationRead(n.notification_id)
    } catch {
      /* ignore */
    }
    setOpen(false)
    nav(n.link_path || '/')
    refresh()
  }

  const onMarkAll = async () => {
    try {
      await markAllNotificationsRead()
      refresh()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100"
        aria-label={unread ? `Bildirimler · ${unread} okunmamış` : 'Bildirimler'}
        aria-expanded={open}
        onClick={onOpen}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-navy-900">Bildirimler</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline disabled:opacity-40"
              onClick={() => void onMarkAll()}
              disabled={!unread}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && !items.length ? (
              <p className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Bildirim yok</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <li key={n.notification_id}>
                    <button
                      type="button"
                      onClick={() => void onClickItem(n)}
                      className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 ${n.read_at ? '' : 'bg-teal-50/40'}`}
                    >
                      <p className="text-sm font-medium text-navy-900">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{n.body}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{fmtDate(n.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
