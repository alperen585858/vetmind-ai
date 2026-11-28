import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import { AppProviders } from './app/providers'
import { ErrorBoundary } from './shared/ui/ErrorBoundary'
import { LocaleProvider, readStoredLocale } from './shared/shell/LocaleContext'
import { isLocaleLoaded, loadLocale } from './i18n'
import './index.css'

// Paylaşılan sürümde (Artifact) adres çubuğu kullanılamadığı için yönlendirme bellekte tutulur.
const Router = import.meta.env.MODE === 'share' ? MemoryRouter : BrowserRouter

const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Router>
        <LocaleProvider>
          <ErrorBoundary fullScreen>
            <AppProviders>
              <App />
            </AppProviders>
          </ErrorBoundary>
        </LocaleProvider>
      </Router>
    </React.StrictMode>,
  )

// English is loaded on demand (src/i18n); a returning English user gets it before the first
// render so the UI does not start in Turkish. Turkish users render immediately.
const initialLocale = readStoredLocale()
if (isLocaleLoaded(initialLocale)) render()
else void loadLocale(initialLocale).catch(() => undefined).finally(render)
