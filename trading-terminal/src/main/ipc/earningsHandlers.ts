import { BrowserWindow } from 'electron'
import { BackendClient, type EarningsTimelineItem } from '../services/BackendClient'
import { groupEarnings } from '../../lib/earningsTimeline'
import { IPC_CHANNELS } from '../../lib/ipcChannels'
import { registerHandler } from './registerHandler'
import { SubscriptionManager } from '../services/SubscriptionManager'
import type { EarningsTimelineData } from '../../lib/types/earningsTimeline'

// 그룹핑은 웹(logothea-web)과 함께 쓰려고 src/lib 로 옮겼다. 기존 import 경로를 위해 다시 내보낸다.
export { groupEarnings }

const POLL_INTERVAL_MS = 5 * 60 * 1000

/** Tier 2 KIS WebSocket 구독 윈도우: T-30분 ~ T+60분 */
const TIER2_LOOKAHEAD_SEC = 30 * 60
const TIER2_LOOKBACK_SEC = 60 * 60

let pollTimer: NodeJS.Timeout | null = null

function pushToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
}

// ─── Tier 2 구독 ─────────────────────────────────────────────────────────────

/**
 * 어닝콜 T-30분 ~ T+60분 구간에 해당하는 ticker 목록 추출.
 * 5분 폴링마다 호출되어 SubscriptionManager.setEarningsTickers 를 갱신한다.
 */
function extractTier2Tickers(items: EarningsTimelineItem[]): string[] {
  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = nowSec - TIER2_LOOKBACK_SEC   // T+60 이후는 제외
  const windowEnd = nowSec + TIER2_LOOKAHEAD_SEC     // T-30 이전은 제외
  return items
    .filter((item) => item.scheduledAt >= windowStart && item.scheduledAt <= windowEnd)
    .map((item) => item.ticker)
}

// ─── fetch + 그룹핑 ─────────────────────────────────────────────────────────

async function fetchAndGroup(): Promise<EarningsTimelineData> {
  const raw = await BackendClient.getEarningsTimeline(90)
  // Tier 2 구독 갱신 — 5분 폴링마다 T-30~T+60 구간 ticker 를 WebSocket 에 등록/해제
  const tier2 = extractTier2Tickers(raw)
  SubscriptionManager.setEarningsTickers(tier2)
  if (tier2.length > 0) {
    console.info('[EarningsHandlers] Tier2 구독 갱신:', tier2.join(', '))
  }
  return groupEarnings(raw)
}

// ─── IPC 핸들러 등록 ─────────────────────────────────────────────────────────

export function registerEarningsHandlers(): void {
  registerHandler<undefined, EarningsTimelineData>(
    IPC_CHANNELS.EARNINGS_TIMELINE_GET,
    async () => {
      try {
        return await fetchAndGroup()
      } catch (e) {
        console.warn('[EarningsHandlers] 타임라인 조회 실패:', e instanceof Error ? e.message : 'unknown')
        return { live: null, groups: [] }
      }
    },
  )
}

// ─── 폴링 lifecycle ───────────────────────────────────────────────────────────

/**
 * 5분 폴링 시작. 즉시 1회 fetch 후 setInterval.
 * 로그인 성공 후 authHandlers 에서 호출한다.
 */
export function start(): void {
  if (pollTimer !== null) return

  void (async () => {
    try {
      const data = await fetchAndGroup()
      pushToRenderer(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, data)
    } catch (e) {
      console.warn('[EarningsHandlers] 초기 타임라인 조회 실패:', e instanceof Error ? e.message : 'unknown')
    }
  })()

  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const data = await fetchAndGroup()
        pushToRenderer(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, data)
      } catch (e) {
        console.warn('[EarningsHandlers] 타임라인 폴링 실패:', e instanceof Error ? e.message : 'unknown')
      }
    })()
  }, POLL_INTERVAL_MS)
}

/** 폴링 중지. 로그아웃/앱 종료 시 호출한다. */
export function stop(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  SubscriptionManager.setEarningsTickers([])
}
