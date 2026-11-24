import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useApp } from './AppContext'
import { LiveStreamConnector } from '../live/liveStream'
import { useLocale } from './LocaleContext'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { PageLoader } from '../ui/PageLoader'

const COLLAPSE_KEY = 'vetmind.sidebar.collapsed'

export function Layout({
  notificationSlot,
  sourcePanel,
}: {
  notificationSlot?: ReactNode
  sourcePanel?: ReactNode
} = {}) {
  const { t } = useLocale()
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const { role, refreshBackendCases, pushToast } = useApp()
  const { pathname } = useLocation()

  // Cases start empty after a page refresh; load them once for every signed-in page
  // (dashboards, sidebar badge) instead of relying on each page to fetch.
  useEffect(() => {
    void refreshBackendCases().then((r) => {
      if (!r.ok && r.error) {
        pushToast({ tone: 'warning', title: r.error })
      }
    })
  }, [role, refreshBackendCases, pushToast])

  useEffect(() => {
    const sync = () => {
      try {
        setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', sync)
    window.addEventListener('vetmind-sidebar-collapse', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('vetmind-sidebar-collapse', sync)
    }
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-transparent" data-role={role || undefined}>
      <LiveStreamConnector enabled={Boolean(role)} />
      <a href="#main-content" className="skip-link no-print">
        {t('nav.skipToContent')}
      </a>
      <Sidebar
        open={menu}
        onClose={() => setMenu(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div
        className={`print:pl-0 transition-[padding] duration-200 ease-out ${
          collapsed ? 'lg:pl-[64px]' : role === 'expert' ? 'lg:pl-56' : 'lg:pl-64'
        }`}
      >
        <Topbar onMenu={() => setMenu(true)} notificationSlot={notificationSlot} />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8 print:p-0"
        >
          {/* Keeps the sidebar and top bar on screen while a page chunk loads. */}
          <Suspense fallback={<PageLoader />}>
            <div className="vm-page-enter" key={pathname}>
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
      {sourcePanel}
    </div>
  )
}
