import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), 'index.html'),
        marketing: resolve(process.cwd(), 'marketing.html'),
      },
    },
  },
})
