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
  useTranscriptTranslation(BROADCAST_TICKER)
  useTranscriptDiff(BROADCAST_TICKER)
  useFactCheck(BROADCAST_TICKER)
  useEarningsSummary(BROADCAST_TICKER)
  return null
}

export type BroadcastView =
  | { kind: 'unknown' }
  | { kind: 'idle' }
  | { kind: 'between'; lastCallId: string | null }
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
  if (status?.kind === 'between') return { kind: 'between', lastCallId: status.callId }
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
