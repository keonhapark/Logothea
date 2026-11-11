import type {
  EarningsTimelineData,
  EarningsTimelineItem,
  EarningsEvent,
  EarningsLiveEvent,
  EarningsGroup,
} from './types/earningsTimeline'

/**
 * 어닝콜 일정 그룹핑. 백엔드 flat list 를 화면용 EarningsTimelineData 로 바꾼다.
 * electron 에 의존하지 않아 main(earningsHandlers)과 웹(logothea-web)이 함께 쓴다.
 */

const KST_OFFSET_SEC = 9 * 3600

/** LIVE 판정 윈도우: 시작 기준 최대 3시간 경과 / 30분 이내 예정 */
const LIVE_LOOKBACK_SEC = 3 * 3600
const LIVE_LOOKAHEAD_SEC = 30 * 60

// ─── 시간 포맷 헬퍼 ─────────────────────────────────────────────────────────

/** epoch seconds → KST 기준 Date (UTC 메서드로 KST 값을 읽는다). */
function kstDate(epochSec: number): Date {
  return new Date(epochSec * 1000 + KST_OFFSET_SEC * 1000)
}

const KST_DAYS = ['일', '월', '화', '수', '목', '금', '토']

/** M/DD 날짜 라벨 (예: "5/11"). */
function formatDateLabel(epochSec: number): string {
  const d = kstDate(epochSec)
  return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Finnhub hour → 한국어 세션 라벨. */
function formatSessionLabel(marketSession: string | null): string {
  if (marketSession === 'bmo') return '장전'
  if (marketSession === 'amc') return '장후'
  if (marketSession === 'dmh') return '장중'
  return '시간미정'
}

function formatElapsed(elapsedSec: number): string {
  const m = Math.floor(elapsedSec / 60)
  const s = elapsedSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function toEarningsEvent(item: EarningsTimelineItem): EarningsEvent {
  const d = kstDate(item.scheduledAt)
  const dayLabel = KST_DAYS[d.getUTCDay()]
  const dateLabel = formatDateLabel(item.scheduledAt)
  const sessionLabel = formatSessionLabel(item.marketSession)
  return {
    ticker: item.ticker,
    name: item.companyName,
    scheduledAt: item.scheduledAt,
    timeLabel: `${dayLabel} ${dateLabel} ${sessionLabel}`,
    whenLabel: `${dayLabel} ${dateLabel}`,
    clockLabel: sessionLabel,
  }
}

// ─── 그룹핑 ─────────────────────────────────────────────────────────────────

/**
 * 백엔드 flat list → EarningsTimelineData 변환.
 *
 * 그룹 기준 (KST 달력 기준):
 *   live     : scheduledAt ∈ [now-3h, now+30min] (첫 번째 매치만)
 *   today    : KST 오늘
 *   tomorrow : KST 내일
 *   week     : 모레 ~ 이번 주 일요일 자정
 *   nextWeek : 다음 주 월~일
 *   later    : 그 이후 ~ 30일
 */
export function groupEarnings(items: EarningsTimelineItem[]): EarningsTimelineData {
  const nowSec = Math.floor(Date.now() / 1000)
  const liveStart = nowSec - LIVE_LOOKBACK_SEC
  const liveEnd = nowSec + LIVE_LOOKAHEAD_SEC

  // KST 자정 경계를 UTC epoch seconds로 계산
  const kstNowSec = nowSec + KST_OFFSET_SEC
  const kstTodayMidnight = Math.floor(kstNowSec / 86400) * 86400
  const todayStartUtc = kstTodayMidnight - KST_OFFSET_SEC
  const tomorrowStartUtc = todayStartUtc + 86400
  const afterTomorrowStartUtc = tomorrowStartUtc + 86400

  // 달력 기준 이번 주 끝(다음 월요일 KST 자정): 0=Sun이면 1일 뒤, 나머지는 (8-dow)일 뒤
  const kstDow = new Date(kstTodayMidnight * 1000).getUTCDay()
  const daysToNextMon = kstDow === 0 ? 1 : 8 - kstDow
  const thisWeekEndUtc = kstTodayMidnight + daysToNextMon * 86400 - KST_OFFSET_SEC
  const nextWeekEndUtc = thisWeekEndUtc + 7 * 86400
  const monthEndUtc = todayStartUtc + 90 * 86400

  let live: EarningsLiveEvent | null = null
  const todayEvents: EarningsEvent[] = []
  const tomorrowEvents: EarningsEvent[] = []
  const weekEvents: EarningsEvent[] = []
  const nextWeekEvents: EarningsEvent[] = []
  const laterEvents: EarningsEvent[] = []

  const sorted = [...items].sort((a, b) => a.scheduledAt - b.scheduledAt)

  for (const item of sorted) {
    const sat = item.scheduledAt

    if (live === null && sat >= liveStart && sat <= liveEnd) {
      const elapsedSec = Math.max(0, nowSec - sat)
      live = {
        ticker: item.ticker,
        name: item.companyName,
        scheduledAt: item.scheduledAt,
        timeLabel: '진행중',
        elapsed: formatElapsed(elapsedSec),
        callLabel: 'Earnings Call',
      }
      continue
    }

    if (sat < todayStartUtc || sat >= monthEndUtc) continue

    if (sat < tomorrowStartUtc) {
      todayEvents.push(toEarningsEvent(item))
    } else if (sat < afterTomorrowStartUtc) {
      tomorrowEvents.push(toEarningsEvent(item))
    } else if (sat < thisWeekEndUtc) {
      weekEvents.push(toEarningsEvent(item))
    } else if (sat < nextWeekEndUtc) {
      nextWeekEvents.push(toEarningsEvent(item))
    } else {
      laterEvents.push(toEarningsEvent(item))
    }
  }

  const groups: EarningsGroup[] = []
  if (todayEvents.length > 0) groups.push({ kind: 'today', label: '오늘', events: todayEvents })
  if (tomorrowEvents.length > 0) groups.push({ kind: 'tomorrow', label: '내일', events: tomorrowEvents })
  if (weekEvents.length > 0) groups.push({ kind: 'week', label: '이번 주', events: weekEvents })
  if (nextWeekEvents.length > 0) groups.push({ kind: 'nextWeek', label: '다음 주', events: nextWeekEvents })
  if (laterEvents.length > 0) groups.push({ kind: 'later', label: '이후', events: laterEvents })

  return { live, groups }
}
