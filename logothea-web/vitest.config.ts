import { defineConfig } from 'vitest/config'
import { terminalBridge } from './tooling/terminalBridge'
import { sharedEsbuild, sharedResolve } from './vite.config'

export default defineConfig({
  plugins: [terminalBridge()],
  resolve: sharedResolve,
  esbuild: sharedEsbuild,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tooling/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    // 통합 테스트가 터미널 store 를 실제 연결 묶음(runtime.ts)으로 돌린다. 가짜 서버만 상대한다.
    env: {
      VITE_DEV_ACCESS_TOKEN: 'test-token',
      VITE_BACKEND_URL: 'http://backend.test',
    },
  },
})
