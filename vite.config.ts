import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 배포(빌드) 시각을 주입한다. 설정 화면의 "버전" 표기에 사용된다.
const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 5173,
    // 로컬 개발 시 `wrangler pages dev`(기본 8788)로 Functions를 띄워두고 /api 프록시.
    proxy: {
      '/api': 'http://127.0.0.1:8788',
    },
  },
})
