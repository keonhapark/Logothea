import { create } from 'zustand'
import type { HighlightedTranslation } from '@terminal/renderer/hooks/useTranscriptTranslation'
import type { GlossaryStatus } from '@terminal/renderer/store/useGlossaryStore'

/**
 * 앱 단위 구독(BroadcastFeeds)이 만든 값 가운데 store 에 없는 것. 번역의 용어 밑줄 위치(spans)는
 * useTranscriptTranslation 훅 안에서 계산되는데, 그 훅은 구독 때문에 한 곳에서만 불러야 해서 결과를 여기에 둔다.
 */
interface CallFeedState {
  translations: readonly HighlightedTranslation[]
  glossaryStatus: GlossaryStatus
}

export const useCallFeed = create<CallFeedState>(() => ({ translations: [], glossaryStatus: 'idle' }))

/**
 * 새 회차가 시작됐는지. 처음 본 회차(중간 입장)는 새 회차로 치지 않는다 — 비울 지난 내용이 없다.
 * 직전 콜 대조 store 는 회차를 구분하지 않고 `sequence:index` 로 중복을 걸러, 비우지 않으면 새 회차의 대조가
 * 지난 회차와 같은 번호라 버려진다(데스크톱은 시연 시작 때 비운다).
 */
export function isNewRound(previousCallId: string | null, latestCallId: string | null): boolean {
  return previousCallId !== null && latestCallId !== null && latestCallId !== previousCallId
}

/**
 * 회차 경계 추적. 자막의 마지막 회차(latest)를 받아, 새 회차면 reset 과 지난 회차 id 를 돌려준다.
 * 재연결 등으로 잠깐 자막이 비어(latest=null) 있어도 마지막으로 본 회차는 잊지 않는다.
 */
export function trackRound(seen: string | null, latest: string | null): { seen: string | null; reset: boolean; retired: string | null } {
  if (latest === null) return { seen, reset: false, retired: null }
  if (isNewRound(seen, latest)) return { seen: latest, reset: true, retired: seen }
  return { seen: latest, reset: false, retired: null }
}

/**
 * 끝난 회차 id. 직전 콜 대조 · 팩트체크는 LLM 이 늦게 만들어 다음 회차가 시작된 뒤에도 도착한다.
 * 터미널 store 는 회차를 보지 않고 `sequence:index` 로 중복을 거르므로, 그대로 넣으면 새 회차의 같은 번호 발언에
 * 엉뚱하게 붙고 진짜 대조는 중복으로 버려진다. 그래서 store 에 넣기 전에(webIpc) 버린다.
 */
const retiredCallIds = new Set<string>()

export function retireCall(callId: string): void {
  retiredCallIds.add(callId)
}

/** 테스트용 — 끝난 회차 기록을 비운다. */
export function clearRetiredCalls(): void {
  retiredCallIds.clear()
}

/** 끝난 회차의 늦은 대조 · 팩트체크면 true. */
export function isRetiredPayload(payload: unknown): boolean {
  const callId = (payload as { call_id?: unknown } | null)?.call_id
  return typeof callId === 'string' && retiredCallIds.has(callId)
}
