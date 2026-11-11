import type { StompBridge } from './stomp'

/**
 * 모바일 브라우저의 화면 잠금 · 탭 전환 · 망 전환 뒤 STOMP 를 새로 붙인다.
 *
 * 이런 상황에서 소켓은 닫힘 이벤트 없이 열린 채 죽는 일이 많다. 백엔드가 heart-beat 를 0 으로 협상해 클라이언트가
 * 이를 알아챌 수 없으므로, 아래 시점에는 상태가 CONNECTED 여도 연결을 버리고 새로 붙는다.
 * - 화면이 HIDDEN_THRESHOLD_MS 이상 가려졌다가 다시 보일 때
 * - 브라우저가 온라인으로 돌아왔을 때
 * - 뒤로 가기 캐시(bfcache)에서 페이지가 되살아났을 때
 *
 * 연결을 시작한 적이 없거나 의도적으로 끊긴 상태(DISCONNECTED)에서는 아무것도 하지 않는다.
 * 새로 붙는 동안 놓친 메시지는 중간 입장 스냅샷(백엔드 작업 대기)으로 채운다.
 */

export const HIDDEN_THRESHOLD_MS = 5_000

interface EventSource {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export interface PageLifecycleEnv {
  document: EventSource & { readonly visibilityState: DocumentVisibilityState }
  window: EventSource
  now?: () => number
}

export function installPageLifecycle(
  stomp: Pick<StompBridge, 'reconnectNow' | 'status'>,
  env: PageLifecycleEnv = { document, window },
): () => void {
  const now = env.now ?? (() => Date.now())
  let hiddenAt: number | null = null

  const refresh = () => {
    if (stomp.status === 'DISCONNECTED') return
    void stomp.reconnectNow()
  }

  const onVisibility = () => {
    if (env.document.visibilityState === 'hidden') {
      hiddenAt = now()
      return
    }
    const hiddenFor = hiddenAt === null ? 0 : now() - hiddenAt
    hiddenAt = null
    if (hiddenFor >= HIDDEN_THRESHOLD_MS) refresh()
  }
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) refresh()
  }

  env.document.addEventListener('visibilitychange', onVisibility)
  env.window.addEventListener('online', refresh)
  env.window.addEventListener('pageshow', onPageShow)
  return () => {
    env.document.removeEventListener('visibilitychange', onVisibility)
    env.window.removeEventListener('online', refresh)
    env.window.removeEventListener('pageshow', onPageShow)
  }
}
