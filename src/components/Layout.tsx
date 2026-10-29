import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SourcePanel } from './SourcePanel'

const COLLAPSE_KEY = 'vetmind.sidebar.collapsed'

export function Layout() {
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const { role, refreshBackendCases } = useApp()

  // Cases start empty after a page refresh; load them once for every signed-in page
  // (dashboards, sidebar badge) instead of relying on each page to fetch.
  useEffect(() => {
    void refreshBackendCases()
  }, [role, refreshBackendCases])

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
    <div className="min-h-screen bg-transparent">
      <a href="#main-content" className="skip-link no-print">
        İçeriğe atla
      </a>
      <Sidebar
        open={menu}
        onClose={() => setMenu(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className={`print:pl-0 transition-[padding] duration-200 ease-out ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <Topbar onMenu={() => setMenu(true)} />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 print:p-0"
        >
          <Outlet />
        </main>
      </div>
      <SourcePanel />
    </div>
  )
}
