import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Brand typefaces — Poppins for display/UI, Inter for body. Self-hosted so
// there is no render-blocking third-party request. Loaded before index.css
// so the @font-face rules exist before the token stylesheet references them.
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'

import './index.css'
import './i18n'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
