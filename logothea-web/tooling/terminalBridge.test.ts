import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { classifyTerminalImport, SWAPPED_MODULES, TERMINAL_SRC, terminalBridge, WEB_ROOT } from './terminalBridge'

const terminal = (relative: string) => path.join(TERMINAL_SRC, relative)

describe('classifyTerminalImport', () => {
  it('터미널 ipc 와 Toast 를 웹 대체 파일로 돌린다', () => {
    expect(classifyTerminalImport(terminal('renderer/lib/ipc.ts'))).toEqual({
      kind: 'swap',
      target: SWAPPED_MODULES['renderer/lib/ipc.ts'],
    })
    expect(classifyTerminalImport(terminal('renderer/components/common/Toast.tsx'))).toMatchObject({ kind: 'swap' })
  })

  it.each([
    'lib/ipcChannels.ts',
    'lib/types/ipcError.ts',
    'renderer/store/useTranscriptStore.ts',
    'renderer/hooks/useLiveTranscript.ts',
    'renderer/lib/callScreen.ts',
    'renderer/types/speakerProfile.ts',
    'renderer/constants/demo.ts',
  ])('허용 목록 안: %s', (relative) => {
    expect(classifyTerminalImport(terminal(relative))).toEqual({ kind: 'allowed' })
  })

  it.each([
    'main/services/StompService.ts',
    'preload/index.ts',
    'renderer/components/call/CallTimeline.tsx',
    'renderer/pages/TradingRoomPage.tsx',
    'renderer/store/__tests__/useTranscriptStore.test.ts',
    'renderer/storefront.ts',
  ])('허용 목록 밖은 막는다: %s', (relative) => {
    expect(classifyTerminalImport(terminal(relative))).toEqual({ kind: 'blocked', relative })
  })

  it('쿼리가 붙은 id 도 파일 경로로 판단한다', () => {
    expect(classifyTerminalImport(terminal('main/index.ts') + '?import')).toMatchObject({ kind: 'blocked' })
  })

  it('터미널 밖의 파일은 관여하지 않는다', () => {
    expect(classifyTerminalImport(path.join(WEB_ROOT, 'src/App.tsx'))).toEqual({ kind: 'outside' })
    expect(classifyTerminalImport(path.join(WEB_ROOT, 'node_modules/react/index.js'))).toEqual({ kind: 'outside' })
  })
})

describe('terminalBridge 플러그인', () => {
  type ResolveResult = { id: string; external?: boolean } | null
  /** importer 에 null 을 주면 진입점(importer 없음)으로 부른다. */
  function run(resolved: ResolveResult, importer: string | null = path.join(WEB_ROOT, 'src/App.tsx')) {
    const plugin = terminalBridge()
    const context = {
      resolve: vi.fn(async () => resolved),
      error: vi.fn((message: string) => {
        throw new Error(message)
      }),
    }
    const hook = plugin.resolveId as unknown as (this: typeof context, source: string, importer: string | undefined, options: object) => Promise<unknown>
    return { context, result: hook.call(context, 'x', importer ?? undefined, {}) }
  }

  it('pre 단계에서 돈다(다른 플러그인보다 먼저 바꿔 끼운다)', () => {
    expect(terminalBridge().enforce).toBe('pre')
  })

  it('자기 자신을 건너뛰고 풀어 본 뒤 판단한다', async () => {
    const { context, result } = run({ id: path.join(WEB_ROOT, 'src/data/http.ts') })
    await result
    expect(context.resolve).toHaveBeenCalledWith('x', expect.any(String), expect.objectContaining({ skipSelf: true }))
  })

  it('바꿔 끼울 파일이면 웹 대체 경로를 돌려준다', async () => {
    const { result } = run({ id: terminal('renderer/lib/ipc.ts') })
    await expect(result).resolves.toBe(SWAPPED_MODULES['renderer/lib/ipc.ts'])
  })

  it('허용 목록 밖이면 빌드 오류를 낸다', async () => {
    const { context, result } = run({ id: terminal('main/services/StompService.ts') })
    await expect(result).rejects.toThrow(/허용 목록 밖/)
    expect(context.error).toHaveBeenCalledTimes(1)
  })

  it('허용 · 외부 · 못 푼 import 는 그대로 넘긴다', async () => {
    const allowed = { id: terminal('renderer/store/useTranscriptStore.ts') }
    await expect(run(allowed).result).resolves.toBe(allowed)
    const external = { id: terminal('main/index.ts'), external: true }
    await expect(run(external).result).resolves.toBe(external)
    await expect(run(null).result).resolves.toBeNull()
  })

  it('진입점(importer 없음)은 풀지 않는다', async () => {
    const { context, result } = run({ id: terminal('main/index.ts') }, null)
    await expect(result).resolves.toBeNull()
    expect(context.resolve).not.toHaveBeenCalled()
  })
})
