import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/ — the deploy workflow sets
  // VITE_BASE=/swashbooks/. Local dev and root-domain hosts use '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
})
