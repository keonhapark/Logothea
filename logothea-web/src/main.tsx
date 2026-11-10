import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installThemeSync } from './app/theme'
import { installSheetHistory } from './app/sheet'
// 터미널 토큰(색 · 글꼴 · 반경 · 그림자)을 먼저, 그 위에 모바일 값을 얹는다
import '@terminal/renderer/styles/tokens.css'
import './index.css'
import './styles/mobile.css'

installThemeSync()
installSheetHistory()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
