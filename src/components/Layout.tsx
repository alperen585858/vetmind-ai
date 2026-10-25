import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SourcePanel } from './SourcePanel'

export function Layout() {
  const [menu, setMenu] = useState(false)
  return (
    <div className="min-h-screen bg-transparent">
      <a href="#main-content" className="skip-link no-print">
        İçeriğe atla
      </a>
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="lg:pl-64 print:pl-0">
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
