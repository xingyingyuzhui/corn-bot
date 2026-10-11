import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Loaded from file:// inside a sandboxed window with a strict CSP: relative
// asset URLs, no inline module-preload polyfill, no inlined assets.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
})
