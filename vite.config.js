import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 確保在部署到 GitHub Pages 時，路徑能正確對應到專案名稱
  base: './' 
})