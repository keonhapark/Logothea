import type { EarningsTimelineData } from '../../lib/types/earningsTimeline'

export interface CallStartAlert {
  /** 같은 콜을 두 번 알리지 않게 하는 열쇠. 일정이 바뀌면 다른 열쇠가 된다. */
  key: string
  ticker: string
  companyName: string
  /** epoch seconds (UTC). */
  scheduledAt: number
  /** 지금부터 알릴 때까지(ms). 이미 알릴 때가 지났으면 0. */
  delayMs: number
}

/** 이만큼 안에 알릴 것만 타이머를 건다. 일정은 5분마다 다시 오므로 그 뒤의 것은 그때 건다. */
export const CALL_START_HORIZON_MS = 6 * 60 * 60 * 1000

/**
 * 관심 · 보유 종목의 다가오는 콜 중 알릴 것을 고른다.
 *
 *  - 콜 시작 `leadMin` 분 전에 알린다. 앱을 그보다 늦게 켰어도 콜이 아직 시작 전이면 바로 알린다.
 *  - 이미 시작한 콜(진행 중 포함)은 알리지 않는다.
 *  - `notified` 에 있는 열쇠는 건너뛴다.
 */
export function planCallStartAlerts(
  timeline: EarningsTimelineData,
  watched: ReadonlySet<string>,
  leadMin: number,
  nowMs: number,
  notified: ReadonlySet<string> = new Set(),
): CallStartAlert[] {
  const alerts: CallStartAlert[] = []
  const seen = new Set<string>()
  // 30분 안으로 다가온 콜은 main 이 groups 에서 빼 live 로 옮긴다(earningsHandlers groupEarnings). 함께 본다.
  const events = [...(timeline.live ? [timeline.live] : []), ...timeline.groups.flatMap((g) => g.events)]
  for (const ev of events) {
    if (!watched.has(ev.ticker)) continue
    const startMs = ev.scheduledAt * 1000
    if (!Number.isFinite(startMs) || startMs <= nowMs) continue
    const key = `${ev.ticker}-${ev.scheduledAt}`
    if (notified.has(key) || seen.has(key)) continue
    const delayMs = Math.max(0, startMs - leadMin * 60_000 - nowMs)
    if (delayMs > CALL_START_HORIZON_MS) continue
    seen.add(key)
    alerts.push({ key, ticker: ev.ticker, companyName: ev.name, scheduledAt: ev.scheduledAt, delayMs })
  }
  return alerts
}
