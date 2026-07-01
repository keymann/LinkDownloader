import { defineConfig } from 'vitest/config'

// 코어(브라우저 API 비의존) 모듈 테스트. 기본 node 환경,
// DOMParser가 필요한 DASH 테스트는 파일 상단 `// @vitest-environment jsdom` 로 개별 지정.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
