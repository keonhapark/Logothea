import { useMemo } from 'react'
import { useTranscriptStore, type TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'
import { useTranscriptDiffStore, type PreviousCall, type TranscriptDiffItem } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useEarningsSummaryStore } from '@terminal/renderer/store/useEarningsSummaryStore'
import type { HighlightedTranslation } from '@terminal/renderer/hooks/useTranscriptTranslation'
import type { GlossaryStatus } from '@terminal/renderer/store/useGlossaryStore'
import type { EarningsSummary } from '@terminal/renderer/types/earningsSummary'
import {
  currentCallSegments,
  deriveCallPhase,
  groupDiffsBySequence,
  translationsByLastSequence,
  type CallPhase,
} from '@terminal/renderer/lib/callScreen'
import { BROADCAST_TICKER } from '../../app/broadcast'
import { useCallFeed } from '../../app/callFeed'

export interface CallData {
  ticker: string
  segments: readonly TranscriptSegment[]
  callId: string | null
  phase: CallPhase
  diffItems: readonly TranscriptDiffItem[]
  diffsBySequence: ReadonlyMap<number, readonly TranscriptDiffItem[]>
  previousCall: PreviousCall | null
  /** 마지막 발언 sequence 기준으로 묶은 번역(지금 회차만). */
  translations: ReadonlyMap<number, HighlightedTranslation>
  glossaryStatus: GlossaryStatus
  /** 지금 회차의 종합 판단. */
  summary: EarningsSummary | null
  /** 지난 회차의 종합 판단(새 회차가 진행 중일 때 "지난 회차" 로 보인다). */
  previousSummary: EarningsSummary | null
}

export interface CallSources {
  segments: readonly TranscriptSegment[]
  endedCallIds: ReadonlySet<string>
  diffItems: readonly TranscriptDiffItem[]
  previousCall: PreviousCall | null
  summary: EarningsSummary | null
  translations: readonly HighlightedTranslation[]
  glossaryStatus: GlossaryStatus
}

/** store 값 → 화면 값. 테스트하려고 훅과 나눴다. */
export function buildCallData(src: CallSources): CallData {
  const segments = currentCallSegments(src.segments)
  const callId = segments.length > 0 ? segments[segments.length - 1].callId : null
  // callId 가 없는 판단은 어느 회차인지 알 수 없어 지금 콜의 것으로 본다(데스크톱 deriveCallPhase 와 같은 규칙)
  const raw = src.summary
  const summaryIsCurrent = raw != null && (raw.callId === null || raw.callId === callId || callId === null)
  const summary = summaryIsCurrent ? raw : null
  const previousSummary = raw && !summaryIsCurrent ? raw : null
  const phase = deriveCallPhase(segments, src.endedCallIds, summary ? summary.callId : undefined)
  // 대조는 회차를 모른다. 새 회차가 시작되면 BroadcastFeeds 가 비우므로, 여기서는 보이는 자막에 있는 발언만 남긴다
  const seqs = new Set(segments.map((s) => s.sequence))
  const diffItems = src.diffItems.filter((d) => seqs.has(d.sequence))
  return {
    ticker: BROADCAST_TICKER,
    segments,
    callId,
    phase,
    diffItems,
    diffsBySequence: groupDiffsBySequence(diffItems),
    previousCall: src.previousCall,
    translations: translationsByLastSequence(src.translations, callId),
    glossaryStatus: src.glossaryStatus,
    summary,
    previousSummary,
  }
}

const NO_ENDED: ReadonlySet<string> = new Set()

/** 콜 화면 네 탭이 함께 읽는 값. 구독은 앱 단위(BroadcastFeeds)에서 걸려 있고 여기서는 store 만 읽는다. */
export function useCallData(): CallData {
  const tickerState = useTranscriptStore((s) => s.byTicker.get(BROADCAST_TICKER))
  const diffState = useTranscriptDiffStore((s) => s.byTicker.get(BROADCAST_TICKER))
  const summary = useEarningsSummaryStore((s) => s.byTicker.get(BROADCAST_TICKER) ?? null)
  const translations = useCallFeed((s) => s.translations)
  const glossaryStatus = useCallFeed((s) => s.glossaryStatus)
  return useMemo(
    () =>
      buildCallData({
        segments: tickerState?.segments ?? [],
        endedCallIds: tickerState?.endedCallIds ?? NO_ENDED,
        diffItems: diffState?.items ?? [],
        previousCall: diffState?.previousCall ?? null,
        summary,
        translations,
        glossaryStatus,
      }),
    [tickerState, diffState, summary, translations, glossaryStatus],
  )
}
