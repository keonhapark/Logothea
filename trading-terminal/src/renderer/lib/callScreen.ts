/**
 * 콜 화면(#155)의 화면 판단 — 렌더링과 떼어 테스트하는 순수 함수 모음.
 *
 *  - 콜 상태: 시작 전 · 진행 중 · 종료 후 (화면의 주인공이 바뀌는 기준)
 *  - 직전 콜 대조를 발언에 붙이기와 펼칠지 판단
 *  - 주문 수량 한도
 */
import type { TranscriptSegment } from '../store/useTranscriptStore'
import type { TranscriptDiffItem, TranscriptDiffChangeType } from '../store/useTranscriptDiffStore'

export type CallPhase = 'BEFORE' | 'LIVE' | 'ENDED'

/**
 * 콜 상태를 정한다.
 *
 * 자막이 없으면 시작 전이다. 마지막 자막의 callId 가 종료 표시를 받았으면 종료 후, 아니면 진행 중이다.
 * 이번 콜의 종합 판단이 도착했으면 종료 표시를 놓쳤어도 종료 후로 본다 — 판단은 콜이 끝나야 만들어진다.
 * 판단의 callId 가 마지막 자막과 다르면 지난 회차 판단이라 상태를 정하는 데 쓰지 않는다.
 * 지난 회차 판단이 늦게 도착해 진행 중인 새 콜을 종료 후로 덮는 일을 막기 위해서다.
 */
export function deriveCallPhase(
  segments: readonly TranscriptSegment[],
  endedCallIds: ReadonlySet<string>,
  summaryCallId: string | null | undefined,
): CallPhase {
  const hasSummary = summaryCallId !== undefined
  if (segments.length === 0) return hasSummary ? 'ENDED' : 'BEFORE'
  const lastCallId = segments[segments.length - 1].callId
  if (endedCallIds.has(lastCallId)) return 'ENDED'
  // callId 가 없는 판단은 어느 회차인지 알 수 없어 지금 콜의 것으로 본다(옛 계약과 호환).
  if (hasSummary && (summaryCallId === null || summaryCallId === lastCallId)) return 'ENDED'
  return 'LIVE'
}

/**
 * 화면에 보일 자막 — 가장 최근 콜(callId)의 것만.
 *
 * 같은 종목을 다시 재생하면 store 에 지난 회차 자막이 남아 있다. 두 회차가 섞이면 발언 번호가
 * 겹쳐 대조가 엉뚱한 발언에 붙는다.
 */
export function currentCallSegments(segments: readonly TranscriptSegment[]): readonly TranscriptSegment[] {
  if (segments.length === 0) return segments
  const lastCallId = segments[segments.length - 1].callId
  if (segments[0].callId === lastCallId) return segments
  return segments.filter((s) => s.callId === lastCallId)
}

/** 대조 항목을 펼친 카드로 보여 주는 위험 점수 기준. ai-engine analysis_guard 의 risk_threshold 와 같다. */
export const PROMINENT_RISK_THRESHOLD = 0.7

/** `후퇴` 이거나 위험 점수가 높은 항목은 칩이 아니라 펼친 카드로 보인다 (design-system 직전 콜 대조). */
export function isProminentDiff(item: TranscriptDiffItem): boolean {
  return item.changeType === 'weakened' || item.riskScore >= PROMINENT_RISK_THRESHOLD
}

/** 발언 번호 → 그 발언에 붙는 대조 항목. 도착 순서를 지킨다. */
export function groupDiffsBySequence(
  items: readonly TranscriptDiffItem[],
): ReadonlyMap<number, readonly TranscriptDiffItem[]> {
  const map = new Map<number, TranscriptDiffItem[]>()
  for (const item of items) {
    const list = map.get(item.sequence)
    if (list) list.push(item)
    else map.set(item.sequence, [item])
  }
  return map
}

/** 변화 유형별 개수. 집계 줄과 종료 후 요약에 쓴다. */
export function countDiffsByType(
  items: readonly TranscriptDiffItem[],
): Record<TranscriptDiffChangeType, number> {
  const counts: Record<TranscriptDiffChangeType, number> = {
    improved: 0,
    weakened: 0,
    unchanged: 0,
    mixed: 0,
    new_claim: 0,
  }
  for (const item of items) counts[item.changeType] += 1
  return counts
}

/**
 * 주문 수량 한도.
 *
 * 매수는 예수금 ÷ 실제 주문 단가(즉시 체결이면 버퍼가 얹힌 가격), 매도는 보유 수량이다.
 * 기준을 모르면(가격 없음 · 잔고 미조회) null — 0 으로 두면 "살 수 없다" 로 읽힌다.
 */
export function maxOrderQty(params: {
  side: 'BUY' | 'SELL'
  unitPrice: number | null
  orderableCash: number
  heldQty: number | null
}): number | null {
  if (params.side === 'SELL') return params.heldQty
  if (params.unitPrice == null || !Number.isFinite(params.unitPrice) || params.unitPrice <= 0) return null
  if (!Number.isFinite(params.orderableCash) || params.orderableCash <= 0) return 0
  return Math.floor(params.orderableCash / params.unitPrice)
}

/** ms → "mm:ss", 한 시간을 넘으면 "h:mm:ss". 콜 시작 기준 경과 시간에 쓴다. */
export function formatCallClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 콜 시작까지 남은 시간. 일정이 지났으면 null — "곧 시작" 처럼 지어낸 상태를 보이지 않고
 * 호출 측이 "예정 시각이 지났습니다" 로 알린다.
 */
export function countdownParts(
  scheduledAtSec: number,
  nowMs: number,
): { days: number; hours: number; minutes: number; seconds: number } | null {
  const diff = scheduledAtSec * 1000 - nowMs
  if (!Number.isFinite(diff) || diff <= 0) return null
  const total = Math.floor(diff / 1000)
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/**
 * 번역 문단을 붙일 자리 — 문단에 담긴 마지막 원문 발언 번호 → 문단.
 *
 * 번역은 원문 몇 개를 묶어 몇 초 늦게 오므로, 묶음의 마지막 발언 아래에 붙여야 원문과 순서가 맞다.
 * 지금 콜(callId)의 번역만 남긴다 — 다시 재생하면 지난 회차 번역이 발언 번호가 겹친 채 남아 있다.
 */
export function translationsByLastSequence<T extends { callId: string; sequences: readonly number[] }>(
  items: readonly T[],
  callId: string | null,
): ReadonlyMap<number, T> {
  const map = new Map<number, T>()
  if (callId == null) return map
  for (const item of items) {
    if (item.callId !== callId || item.sequences.length === 0) continue
    // sequences 는 store 가 오름차순으로 맞춰 둔다
    map.set(item.sequences[item.sequences.length - 1], item)
  }
  return map
}

/**
 * 최근 어닝 반응의 EPS 막대가 함께 쓰는 눈금 범위. 분기마다 예상과 실제는 몇 센트 차이라
 * 0 에서 시작하면 막대 끝이 모두 같아 보인다. 그래서 값들의 최솟값 아래로 여유를 두고 시작해
 * 예상을 넘었는지 못 미쳤는지가 막대 길이로 보이게 한다. 값이 하나도 없으면 null.
 */
export function epsBulletDomain(values: readonly (number | null)[]): readonly [number, number] | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || Math.max(Math.abs(max) * 0.1, 0.01)
  return [min - span * 0.6, max + span * 0.15]
}

/** 눈금 범위 안의 비율(0~1). 범위를 벗어나면 양 끝에 붙인다. */
export function epsBulletRatio(value: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
}

/** 가로 시간축의 점 하나 — 한 발언에 붙은 대조 항목들과 그 발언의 시작 시각 · 축 위 비율(0~1). */
export interface TimelineMark {
  sequence: number
  startMs: number
  ratio: number
  /** 도착 순서. 같은 발언의 대조는 한 점으로 묶는다(겹치면 위의 점만 눌린다). */
  items: TranscriptDiffItem[]
  /** 점의 색 · 크기를 정하는 항목 — 후퇴 · 고위험이 있으면 그것, 없으면 먼저 온 것. */
  lead: TranscriptDiffItem
}

/**
 * 가로 시간축(W11)에 찍을 점. 축은 콜 처음부터 마지막 발언 끝까지이고, 진행 중이면 오른쪽 끝이 지금이다.
 * 지금 보이는 자막에 없는 발언(지난 회차 · 아직 안 온 발언)의 대조는 찍지 않는다. 점은 시각 순이다.
 */
export function timelineMarks(
  segments: readonly TranscriptSegment[],
  items: readonly TranscriptDiffItem[],
): { totalMs: number; marks: TimelineMark[] } {
  const totalMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0
  if (!(totalMs > 0)) return { totalMs: 0, marks: [] }
  const startBySeq = new Map(segments.map((s) => [s.sequence, s.startMs]))
  const bySeq = new Map<number, TimelineMark>()
  for (const item of items) {
    const startMs = startBySeq.get(item.sequence)
    if (startMs == null) continue
    const mark = bySeq.get(item.sequence)
    if (mark) {
      mark.items.push(item)
      if (!isProminentDiff(mark.lead) && isProminentDiff(item)) mark.lead = item
    } else {
      bySeq.set(item.sequence, {
        sequence: item.sequence,
        startMs,
        ratio: Math.min(1, Math.max(0, startMs / totalMs)),
        items: [item],
        lead: item,
      })
    }
  }
  return { totalMs, marks: [...bySeq.values()].sort((x, y) => x.startMs - y.startMs) }
}

/**
 * 세로 시간축에서 현재 스크롤 중인 뷰포트 영역의 위치와 높이 비율(0~100%).
 * 스크롤 높이가 컨테이너 이하이면 전체(0~100%)를 채우고,
 * 스크롤 가능한 경우 현재 보이는 높이 비율에 맞춰 계산하되 최소 높이(minHeightRatio)를 보장한다.
 */
export interface ViewportIndicator {
  topPercent: number
  heightPercent: number
}

export function computeViewportIndicator(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  minHeightRatio = 0.08,
): ViewportIndicator {
  if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return { topPercent: 0, heightPercent: 100 }
  }
  const rawHeightRatio = clientHeight / scrollHeight
  const heightRatio = Math.min(1, Math.max(minHeightRatio, rawHeightRatio))
  const maxScroll = scrollHeight - clientHeight
  const scrollFraction = Math.max(0, Math.min(1, scrollTop / maxScroll))
  const topRatio = scrollFraction * (1 - heightRatio)
  return {
    topPercent: topRatio * 100,
    heightPercent: heightRatio * 100,
  }
}
