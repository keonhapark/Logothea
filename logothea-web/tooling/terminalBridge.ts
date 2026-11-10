import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * trading-terminal 의 순수 로직(store · 훅 · lib · 타입)을 웹 번들에 그대로 가져오기 위한 플러그인.
 *
 * 1. 바꿔 끼우기: 터미널 화면 코드는 데이터를 전부 `renderer/lib/ipc.ts` 로만 받는다. 그 파일을 웹 구현으로
 *    바꾸면 훅 · store 를 고치지 않고 브라우저에서 돌릴 수 있다. 로그인 전제 문구가 든 Toast 도 같이 바꾼다.
 * 2. 허용 목록: 목록 밖의 터미널 파일(main · preload · 화면 컴포넌트)을 끌어오면 빌드를 멈춘다.
 *    Electron 코드가 웹 번들에 섞이는 것을 막는다. 넓힐 때는 파일 단위로 추가한다(README 참고).
 *
 * 훅 · store 는 상대 경로(`../lib/ipc`)로 import 하므로 별칭으로는 잡히지 않는다. 그래서 import 를 실제 경로로
 * 풀어 본 뒤 판단한다.
 */

export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const TERMINAL_SRC = path.resolve(WEB_ROOT, '../trading-terminal/src')

/** 터미널 파일 → 웹 대체 파일. 키는 TERMINAL_SRC 기준 상대 경로. */
export const SWAPPED_MODULES: Readonly<Record<string, string>> = {
  'renderer/lib/ipc.ts': path.resolve(WEB_ROOT, 'src/bridge/ipc.ts'),
  'renderer/components/common/Toast.tsx': path.resolve(WEB_ROOT, 'src/bridge/Toast.ts'),
}

/** 가져와도 되는 디렉터리(접두사). 끝의 `/` 까지 맞춰 비교한다. */
export const ALLOWED_DIRS: readonly string[] = [
  'lib/',
  'renderer/store/',
  'renderer/hooks/',
  'renderer/lib/',
  'renderer/types/',
  'renderer/constants/',
]

/** 디렉터리 밖이지만 한 파일씩 허용한 것. PR 2 에서 디자인 토큰 · 화면 조각을 가져올 때 여기에 더한다. */
export const ALLOWED_FILES: readonly string[] = []

export type TerminalImport =
  | { kind: 'outside' }
  | { kind: 'swap'; target: string }
  | { kind: 'allowed' }
  | { kind: 'blocked'; relative: string }

/** 이미 풀린 절대 경로를 보고 어떻게 다룰지 정한다. */
export function classifyTerminalImport(resolvedId: string): TerminalImport {
  const file = resolvedId.split('?')[0]
  const relative = path.relative(TERMINAL_SRC, file).split(path.sep).join('/')
  if (relative.startsWith('../') || path.isAbsolute(relative)) return { kind: 'outside' }

  const swap = SWAPPED_MODULES[relative]
  if (swap) return { kind: 'swap', target: swap }
  if (/(^|\/)__tests__\//.test(relative)) return { kind: 'blocked', relative }
  if (ALLOWED_FILES.includes(relative)) return { kind: 'allowed' }
  if (ALLOWED_DIRS.some((dir) => relative.startsWith(dir))) return { kind: 'allowed' }
  return { kind: 'blocked', relative }
}

export function terminalBridge(): Plugin {
  return {
    name: 'logothea-terminal-bridge',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // 진입점(importer 없음)은 터미널 파일일 수 없다
      if (!importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external) return resolved
      const verdict = classifyTerminalImport(resolved.id)
      switch (verdict.kind) {
        case 'outside':
        case 'allowed':
          return resolved
        case 'swap':
          return verdict.target
        case 'blocked':
          this.error(
            `[terminal-bridge] 허용 목록 밖의 trading-terminal 파일입니다: src/${verdict.relative}\n` +
              `  import 한 곳: ${path.relative(WEB_ROOT, importer)}\n` +
              '  필요하면 tooling/terminalBridge.ts 의 ALLOWED_FILES 에 파일 단위로 추가합니다.',
          )
      }
    },
  }
}
