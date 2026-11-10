import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { webIpc } from '../data/runtime'

/**
 * trading-terminal `src/renderer/lib/ipc.ts` 의 웹 대체 모듈.
 * tooling/terminalBridge.ts 가 터미널 훅 · store 의 `../lib/ipc` import 를 이 파일로 돌린다.
 *
 * 내보내는 이름과 모양은 원본과 같아야 한다. 아래 타입 주석이 원본의 `ipc` 타입을 그대로 요구하므로,
 * 원본 모양이 바뀌면 typecheck 가 여기서 실패한다.
 */
type TerminalIpc = typeof import('@terminal/renderer/lib/ipc').ipc

export const ipc: TerminalIpc = webIpc

/** 원본은 Electron 창 모양 분기에 쓴다. 웹에는 해당이 없다. */
export const isMac = false

export { IPC_CHANNELS }
