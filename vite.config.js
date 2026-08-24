import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { getBankOfTaiwanRates } from './server/bankOfTaiwanRates.js'

const bankOfTaiwanApi = () => ({
  name: 'bank-of-taiwan-exchange-rate-api',
  configureServer(server) {
    server.middlewares.use('/api/exchange-rates', async (_request, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      try {
        response.statusCode = 200
        response.end(JSON.stringify(await getBankOfTaiwanRates()))
      } catch (error) {
        response.statusCode = 502
        response.end(JSON.stringify({ error: error.message || '無法取得臺灣銀行匯率' }))
      }
    })
  }
})

export default defineConfig({
  plugins: [react(), bankOfTaiwanApi()],
  // 確保在部署到 GitHub Pages 時，路徑能正確對應到專案名稱
  base: './' 
})
