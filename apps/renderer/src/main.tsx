import { createRoot } from 'react-dom/client'
import { CornApp } from './app/CornApp.tsx'
import './styles/tokens.css'
import './styles/global.css'
import './styles/layout.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')
createRoot(container).render(<CornApp />)
