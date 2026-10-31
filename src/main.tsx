import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './context/AppContext'
import { LocaleProvider } from './context/LocaleContext'
import './index.css'

// Paylaşılan sürümde (Artifact) adres çubuğu kullanılamadığı için yönlendirme bellekte tutulur.
const Router = import.meta.env.MODE === 'share' ? MemoryRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <LocaleProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </LocaleProvider>
    </Router>
  </React.StrictMode>,
)
