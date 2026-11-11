import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { DEMO_TICKER } from '@terminal/renderer/constants/demo'
import { useLiveTranscript } from '@terminal/renderer/hooks/useLiveTranscript'
import { useTranscriptTranslation } from '@terminal/renderer/hooks/useTranscriptTranslation'
import { useTranscriptDiff } from '@terminal/renderer/hooks/useTranscriptDiff'
import { useFactCheck } from '@terminal/renderer/hooks/useFactCheck'
import { useEarningsSummary } from '@terminal/renderer/hooks/useEarningsSummary'
import { useTranscriptStore, type TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'
import { currentCallSegments } from '@terminal/renderer/lib/callScreen'
import { useTranscriptDiffStore } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useFactCheckStore } from '@terminal/renderer/store/useFactCheckStore'
import { useAssistantStore } from '@terminal/renderer/store/useAssistantStore'
import { retireCall, trackRound, useCallFeed } from './callFeed'
import { useCallUi } from './callUi'
import { fetchBroadcastStatus, type BroadcastStatus } from '../data/broadcast'
import { http } from '../data/runtime'

/** 웹이 방송하는 종목. 백엔드 시연 스크립트의 종목과 같다(터미널 constants/demo.ts). */
export const BROADCAST_TICKER = DEMO_TICKER

const STATUS_POLL_MS = 20_000
/** 마지막 자막이 이보다 오래됐으면 상태 조회 없이 방송 중이라고 하지 않는다. */
const STALE_SEGMENT_MS = 90_000

/**
 * 방송 종목의 실시간 구독을 앱 전체에서 한 번만 건다. 탭을 옮겨도 자막 · 번역 · 대조 · 팩트체크 · 판단이 계속 쌓여,
 * 홈에서 콜 탭으로 넘어가도 앞부분이 비지 않는다. 터미널 훅은 "한 화면에서 한 번만 호출" 규칙이 있어(구독에
 * 참조 카운트가 없음) 화면마다 부르지 않고 여기서만 부른다. 화면은 store 를 읽는다.
 */
const useStatusStore = create<{ status: BroadcastStatus | null; checkedAt: number }>(() => ({ status: null, checkedAt: 0 }))

export function BroadcastFeeds() {
  // 상태 조회도 여기서 한 번만 돈다. 탭 바(콜 점)와 홈 카드가 같은 값을 읽는다.
  useEffect(() => {
    let cancelled = false
    const poll = () => {
      void fetchBroadcastStatus(http, BROADCAST_TICKER).then((status) => {
        if (cancelled) return
        // 한 번 실패했다고 아는 상태를 지우지 않는다. 회차 사이처럼 자막이 없는 동안 카드가 깜빡인다
        if (status) useStatusStore.setState({ status, checkedAt: Date.now() })
      })
    }
    poll()
    const timer = window.setInterval(poll, STATUS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  useLiveTranscript(BROADCAST_TICKER)
  const translation = useTranscriptTranslation(BROADCAST_TICKER)
  useEffect(() => {
    useCallFeed.setState({ translations: translation.items, glossaryStatus: translation.glossaryStatus })
  }, [translation.items, translation.glossaryStatus])

  // 새 회차가 시작되면 지난 회차의 대조 · 팩트체크 · 질문 대화 · 범위를 비운다. 판단은 "지난 회차" 로 남긴다.
  useEffect(() => watchRounds(), [])

  useTranscriptDiff(BROADCAST_TICKER)
  useFactCheck(BROADCAST_TICKER)
  useEarningsSummary(BROADCAST_TICKER)
  return null
}

function latestCallIdOf(state: ReturnType<typeof useTranscriptStore.getState>): string | null {
  const segments = state.byTicker.get(BROADCAST_TICKER)?.segments
  return segments && segments.length > 0 ? segments[segments.length - 1].callId : null
}

/**
 * 자막 store 를 지켜보다 새 회차의 첫 자막이 들어오는 순간 지난 회차를 비운다. 끄는 함수를 돌려준다.
 *
 * React effect 가 아니라 store 구독으로 하는 이유: 스냅샷(data/snapshot.ts)은 자막 · 번역 · 대조를 한 번에 연달아
 * 흘려 넣는다. 화면이 다시 그려진 뒤에 비우면 방금 들어온 새 회차의 대조까지 지워진다. store 구독은 자막이 들어간
 * 직후, 같은 스냅샷의 대조가 들어오기 전에 불린다.
 */
export function watchRounds(): () => void {
  let seen = latestCallIdOf(useTranscriptStore.getState())
  return useTranscriptStore.subscribe((state) => {
    const next = trackRound(seen, latestCallIdOf(state))
    seen = next.seen
    if (next.reset && next.retired) resetCallRound(next.retired)
  })
}

/**
 * 새 회차로 넘어갈 때 지난 회차 내용을 비운다. 끝난 회차 id 는 기억해 두고 늦게 오는 대조 · 팩트체크를 버린다.
 * 자막 store 는 비우지 않는다(currentCallSegments 가 최근 회차만 보여 준다). 판단은 "지난 회차" 로 남긴다.
 */
export function resetCallRound(retiredCallId: string): void {
  retireCall(retiredCallId)
  useTranscriptDiffStore.getState().clearTicker(BROADCAST_TICKER)
  useFactCheckStore.getState().clearTicker(BROADCAST_TICKER)
  useAssistantStore.getState().reset()
  useCallUi.getState().resetRound()
}

export type BroadcastView =
  | { kind: 'unknown' }
  | { kind: 'idle' }
  /** loop 이면 회차 사이(다음 회차를 준비 중), 아니면 방송을 마쳤다. */
  | { kind: 'between'; lastCallId: string | null; loop: boolean }
  | { kind: 'live'; callId: string | null; segments: readonly TranscriptSegment[] }

/**
 * 방송 상태 = 상태 API + 자막 store.
 * - 상태 API 가 재생 중이라고 하거나, 끝나지 않은 회차의 자막이 최근에 왔으면 방송 중.
 * - 상태 API 가 재생 기록만 있다고 하면 회차 사이.
 * - 상태 API 를 못 읽었고 최근 자막도 없으면 모름(홈은 카드를 두지 않는다).
 */
export function deriveBroadcastView(
  status: BroadcastStatus | null,
  segments: readonly TranscriptSegment[],
  endedCallIds: ReadonlySet<string>,
  nowMs: number,
): BroadcastView {
  const current = currentCallSegments(segments)
  const last = current[current.length - 1]
  const recentOpen = last != null && !endedCallIds.has(last.callId) && nowMs - last.timestamp * 1000 < STALE_SEGMENT_MS
  if (status?.kind === 'live' || recentOpen) {
    const callId = status?.kind === 'live' ? status.callId ?? last?.callId ?? null : last.callId
    const callSegments = callId ? current.filter((s) => s.callId === callId) : current
    return { kind: 'live', callId, segments: callSegments }
  }
  if (status?.kind === 'between') return { kind: 'between', lastCallId: status.callId, loop: status.loop }
  if (status?.kind === 'idle') return { kind: 'idle' }
  return { kind: 'unknown' }
}

export function useBroadcastView(): BroadcastView {
  const status = useStatusStore((s) => s.status)
  const checkedAt = useStatusStore((s) => s.checkedAt)
  const tickerState = useTranscriptStore((s) => s.byTicker.get(BROADCAST_TICKER))
  return useMemo(
    () => deriveBroadcastView(status, tickerState?.segments ?? [], tickerState?.endedCallIds ?? new Set(), Math.max(checkedAt, Date.now())),
    [status, checkedAt, tickerState],
  )
}
