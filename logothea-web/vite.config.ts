import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { terminalBridge, TERMINAL_SRC } from './tooling/terminalBridge'
import { assertBuildEnv } from './tooling/envGuard'

/**
 * 터미널 파일이 import 하는 react · zustand 등은 이 모듈의 node_modules 에서 찾게 한다(dedupe).
 * 그러지 않으면 trading-terminal/node_modules 를 찾아가 React 가 두 벌 들어가거나, 설치돼 있지 않아 실패한다.
 */
export const sharedResolve = {
  alias: { '@terminal': TERMINAL_SRC },
  dedupe: ['react', 'react-dom', 'zustand', '@stomp/stompjs'],
}

// esbuild 는 파일마다 가장 가까운 tsconfig 를 찾는다. 터미널 파일이면 trading-terminal/tsconfig.json 을 읽는데,
// 그 설정은 터미널 node_modules(@electron-toolkit/tsconfig)를 extends 해서 여기서는 풀리지 않는다.
// 변환 설정을 문자열로 주면 찾지 않는다(객체로 주면 찾은 뒤 합친다). 타입 검사는 tsc 가 따로 한다.
export const sharedEsbuild = {
  tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'es2022', useDefineForClassFields: true } }),
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') assertBuildEnv(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    plugins: [terminalBridge(), react()],
    resolve: sharedResolve,
    esbuild: sharedEsbuild,
    server: {
      // 터미널 src 를 개발 서버가 읽을 수 있게 한다
      fs: { allow: ['.', TERMINAL_SRC] },
    },
  }
})
