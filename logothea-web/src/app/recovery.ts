import { useGlossaryStore } from '@terminal/renderer/store/useGlossaryStore'
import type { GuestStatus } from '../data/auth'
import { REFRESH_TIMELINE } from '../data/marketChannels'
import { guest, webIpc } from '../data/runtime'

/**
 * 게스트 토큰 장애(429 · 503 · 연결 실패)가 풀리면, 그동안 실패해 비어 있는 조회를 다시 한다.
 * - 어닝콜 일정: 지금 다시 받아 갱신 push 로 민다(useEarningsTimeline 이 받는다)
 * - 용어 사전: 실패 상태를 풀고 다시 받는다(터미널 store 는 실패 뒤 일정 시간 다시 묻지 않는다)
 * 방송 상태는 20초 폴링, STOMP 는 백오프 재연결, 시장 데이터는 인증 없이 받으므로 따로 하지 않는다.
 * 화자 명부는 시트를 열 때마다 새로 받는다.
 */
export function installRecovery(): () => void {
  if (!guest) return () => undefined
  let previous: GuestStatus = guest.status
  return guest.onStatus((next) => {
    const recovered = next === 'ready' && (previous === 'rate_limited' || previous === 'unavailable')
    previous = next
    if (!recovered) return
    void webIpc.invoke(REFRESH_TIMELINE)
    const glossary = useGlossaryStore.getState()
    if (glossary.status === 'failed') {
      useGlossaryStore.setState({ status: 'idle', lastAttemptAt: 0 })
      void useGlossaryStore.getState().load()
    }
  })
}
