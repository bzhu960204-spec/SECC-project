import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Update CONTACT_EMAIL to your own address for SEC Fair Access compliance.
// This value is injected by Vite's Node process, so it actually reaches SEC servers.
const CONTACT_EMAIL = process.env.SEC_CONTACT_EMAIL ?? 'not-provided'
const SEC_USER_AGENT = `SECC Project SEC Filings Downloader (contact=${CONTACT_EMAIL})`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // SEC EDGAR submissions / company data  (data.sec.gov)
      '/api/sec-data': {
        target: 'https://data.sec.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sec-data/, ''),
        headers: { 'User-Agent': SEC_USER_AGENT },
      },
      // SEC main site: company tickers + filing archives  (www.sec.gov)
      '/api/sec': {
        target: 'https://www.sec.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sec/, ''),
        headers: { 'User-Agent': SEC_USER_AGENT },
      },
    },
  },
})
