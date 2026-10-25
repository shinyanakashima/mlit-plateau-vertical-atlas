import './cesiumSetup'
import '@fontsource/noto-sans-jp/400.css'
import '@fontsource/noto-sans-jp/500.css'
import '@fontsource/noto-sans-jp/700.css'
import '@fontsource/noto-serif-jp/700.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import MansionApp from './mansion/MansionApp'

// lt11-mansion branch: the LT11 prototype "東京は何階建て？" is the default screen.
// The shared PLATEAU Vertical Atlas engine/UI stays available with ?app=atlas.
const atlasMode = new URLSearchParams(location.search).get('app') === 'atlas'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {atlasMode ? <App /> : <MansionApp />}
    </ErrorBoundary>
  </StrictMode>,
)
