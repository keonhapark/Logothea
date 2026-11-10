import { isIpcError } from '@terminal/lib/types/ipcError'

/**
 * trading-terminal `src/renderer/components/common/Toast.tsx` 의 웹 대체 모듈.
 *
 * 원본은 react-hot-toast 로 그리고 "다시 로그인" 같은 로그인 전제 버튼을 붙인다. 웹에는 로그인이 없고
 * 알림 모양은 모바일 화면 명세에서 정하므로, 여기서는 메시지만 모아 구독자에게 넘긴다.
 * 허용 목록 안의 터미널 코드가 쓰는 이름(showIpcErrorToast, setAuthExpiredHandler)만 둔다.
 */

export interface WebNotice {
  code: string
  message: string
}

const listeners = new Set<(notice: WebNotice) => void>()

type TerminalShowToast = typeof import('@terminal/renderer/components/common/Toast').showIpcErrorToast

/** 원본과 같은 모양이어야 한다. 원본 시그니처가 바뀌면 typecheck 가 여기서 실패한다. */
export const showIpcErrorToast: TerminalShowToast = (err, _opts = {}) => {
  const notice: WebNotice = isIpcError(err)
    ? { code: err.code, message: err.message }
    : { code: 'UNKNOWN', message: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.' }
  for (const listener of listeners) listener(notice)
}

/** 웹에는 재로그인 흐름이 없어 받기만 하고 쓰지 않는다. */
export function setAuthExpiredHandler(_handler: (() => void) | null): void {}

export function onNotice(listener: (notice: WebNotice) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
