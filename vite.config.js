import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change 'nda-tracker' to your GitHub repo name
const REPO_NAME = 'nda-tracker'

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? `/${REPO_NAME}/` : '/',
})
