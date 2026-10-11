import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const PROD_CSP_SOURCES = "script-src 'self'; style-src 'self'"
const DEV_CSP_SOURCES =
  "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
const PROD_CONNECT = "connect-src 'none'"
const DEV_CONNECT = "connect-src 'self' ws:"

// The dev server injects <style> tags, the React Refresh preamble and an HMR
// socket, all of which the shipped CSP forbids. Only `vite serve` relaxes it.
function devOnlyCsp(): Plugin {
  return {
    name: 'corn-dev-only-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!html.includes(PROD_CSP_SOURCES) || !html.includes(PROD_CONNECT)) {
        throw new Error('index.html CSP changed; update corn-dev-only-csp')
      }
      return html
        .replace(PROD_CSP_SOURCES, DEV_CSP_SOURCES)
        .replace(PROD_CONNECT, DEV_CONNECT)
    },
  }
}

// Loaded from file:// inside a sandboxed window with a strict CSP: relative
// asset URLs, no inline module-preload polyfill, no inlined assets.
export default defineConfig({
  base: './',
  plugins: [react(), devOnlyCsp()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
})
