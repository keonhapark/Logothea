import type { HttpClient } from './http'

/**
 * 시연 방송 상태 (Contract 7.8 `GET /api/v1/demo/earnings-call/status?ticker=`). IPC 채널이 아니라 웹 전용이다.
 *
 * - 재생 중: `{ running: true, ticker, call_id, published_count, total_segments }`
 * - 끝남: `{ running: false, ticker, last_run: { call_id, outcome, published_count, total_segments } }`
 * - 기록 없음: `{ running: false, ticker }`
 * - 모든 응답에 `loop`: 반복 방송이 그 종목을 맡고 있는지. 회차 사이에 "다음 회차를 준비하고 있습니다" 를 띄울지 정한다.
 *
 * 홈의 진행 중인 콜 카드는 이 값과 자막 store 로 정한다. 일정의 `live` 추정(예정 시각 창)은 쓰지 않는다.
 */

export type BroadcastStatus =
  | { kind: 'live'; callId: string | null; loop: boolean }
  /** 재생 기록은 있지만 지금은 쉬는 중. loop 이면 회차 사이(다음 회차가 온다), 아니면 방송을 마쳤다. */
  | { kind: 'between'; callId: string | null; loop: boolean }
  /** 재생한 적이 없다. */
  | { kind: 'idle'; loop: boolean }

export function parseBroadcastStatus(raw: unknown): BroadcastStatus | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.running !== 'boolean') return null
  // 옛 서버는 loop 를 싣지 않는다. 그때는 반복 방송이 아닌 것으로 본다
  const loop = r.loop === true
  if (r.running) return { kind: 'live', callId: typeof r.call_id === 'string' ? r.call_id : null, loop }
  const last = r.last_run
  if (last !== null && typeof last === 'object') {
    const callId = (last as Record<string, unknown>).call_id
    return { kind: 'between', callId: typeof callId === 'string' ? callId : null, loop }
  }
  return { kind: 'idle', loop }
}

/** 실패하면 null — 홈은 그때 카드를 두지 않는다(방송을 모름). */
export async function fetchBroadcastStatus(http: Pick<HttpClient, 'getJson'>, ticker: string): Promise<BroadcastStatus | null> {
  try {
    return parseBroadcastStatus(await http.getJson(`/api/v1/demo/earnings-call/status?ticker=${encodeURIComponent(ticker)}`))
  } catch {
    return null
  }
}
