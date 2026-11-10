import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { IpcError, isIpcError } from '@terminal/lib/types/ipcError'
import { groupEarnings } from '@terminal/lib/earningsTimeline'
import type { EarningsTimelineData, EarningsTimelineItem } from '@terminal/lib/types/earningsTimeline'
import type { Sp500Stock, StockPriceEntry } from '@terminal/lib/types/stockList'
import type { StockDetailResponsePayload } from '@terminal/lib/types/stockDetail'
import type { HttpClient } from './http'
import type { StompBridge } from './stomp'

/**
 * 홈 · 시장 · 종목 브리핑 화면이 쓰는 채널. 터미널 main 의 handler 를 브라우저로 옮겼다.
 *
 * | 채널 | 터미널 원본 |
 * |---|---|
 * | EARNINGS_TIMELINE_GET / UPDATE | main/ipc/earningsHandlers.ts (5분 폴링) |
 * | MARKET_INDICES_GET / UPDATE | main/ipc/marketHandlers.ts, StompService `/topic/market/indices` |
 * | STOCKS_SP500_GET, STOCK_PRICES_SNAPSHOT_GET | main/ipc/stockListHandlers.ts |
 * | PRICES_GET / UPDATE | main/ipc/pricesHandlers.ts, StompService `/topic/prices` |
 * | STOCK_GET_DETAIL | main/ipc/stockDetailHandlers.ts (30초 · 부분 응답 5초 캐시) |
 *
 * push 채널(UPDATE)은 화면이 듣고 있는 동안에만 폴링하거나 STOMP 를 구독한다. 터미널은 로그인 뒤 늘 켜 두지만,
 * 휴대폰에서 보지 않는 화면의 데이터까지 받을 이유가 없다.
 *
 * 터미널과 다른 점: 시세는 KIS 폴링 없이 백엔드 STOMP(Finnhub 중계)와 스냅샷 REST 만 쓴다. 어닝콜 일정에서
 * KIS 구독 대상(Tier 2)을 고르는 부분은 웹에 KIS 가 없어 뺐다.
 */

export const TIMELINE_POLL_MS = 5 * 60 * 1000
export const TIMELINE_DAYS = 90
const SP500_CACHE_MS = 5 * 60 * 1000
const DETAIL_TTL_MS = 30_000
const DETAIL_PARTIAL_TTL_MS = 5_000
const DETAIL_TICKER = /^[A-Z0-9.-]{1,10}$/

const EMPTY_TIMELINE: EarningsTimelineData = { live: null, groups: [] }

interface PriceEntry {
  currentPrice: number
  previousClose: number
  lastUpdated: number
}

export interface ChannelRegistry {
  handle(channel: string, handler: (payload: unknown) => Promise<unknown>): void
  /** 리스너가 처음 붙을 때 start, 마지막으로 떨어질 때 그 반환값(stop)을 부른다. */
  source(channel: string, start: () => () => void): void
  emit(channel: string, payload: unknown): void
}

export interface MarketChannelDeps {
  http: Pick<HttpClient, 'getJson'>
  stomp: StompBridge
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  now?: () => number
}

export function registerMarketChannels(registry: ChannelRegistry, deps: MarketChannelDeps): void {
  const setRepeat = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const clearRepeat = deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
  const now = deps.now ?? (() => Date.now())

  // ── 어닝콜 일정 ────────────────────────────────────────────────────────────
  async function fetchTimeline(): Promise<EarningsTimelineData> {
    const raw = await deps.http.getJson<unknown>(`/api/v1/earnings-calendar/terminal-timeline?days=${TIMELINE_DAYS}`)
    return groupEarnings(Array.isArray(raw) ? (raw as EarningsTimelineItem[]) : [])
  }
  // GET 은 터미널 handler 처럼 실패해도 reject 하지 않고 빈 일정을 돌려준다.
  registry.handle(IPC_CHANNELS.EARNINGS_TIMELINE_GET, async () => {
    try {
      return await fetchTimeline()
    } catch (e) {
      console.warn('[market] 어닝콜 일정 조회 실패:', e)
      return EMPTY_TIMELINE
    }
  })
  // 폴링이 실패하면 아무것도 보내지 않는다. 빈 일정을 보내면 화면이 받아 둔 일정을 지운다(터미널 start() 와 같음).
  registry.source(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, () => {
    const handle = setRepeat(() => {
      fetchTimeline().then(
        (data) => registry.emit(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, data),
        (e) => console.warn('[market] 어닝콜 일정 폴링 실패:', e),
      )
    }, TIMELINE_POLL_MS)
    return () => clearRepeat(handle)
  })

  // ── 시장 지수 ──────────────────────────────────────────────────────────────
  registry.handle(IPC_CHANNELS.MARKET_INDICES_GET, async () => {
    try {
      const data = await deps.http.getJson<unknown>('/api/v1/market/indices')
      return Array.isArray(data) ? data : []
    } catch (e) {
      if (isIpcError(e) && e.code === 'AUTH_EXPIRED') throw e
      console.error('[market] 시장 지수 조회 실패:', e)
      return []
    }
  })
  registry.source(IPC_CHANNELS.MARKET_INDICES_UPDATE, () =>
    subscribeTopic('/topic/market/indices', (payload) => registry.emit(IPC_CHANNELS.MARKET_INDICES_UPDATE, payload)),
  )

  // ── 종목 목록 · 시세 ───────────────────────────────────────────────────────
  let sp500Cache: Sp500Stock[] | null = null
  let sp500CachedAt = 0
  registry.handle(IPC_CHANNELS.STOCKS_SP500_GET, async () => {
    if (sp500Cache && now() - sp500CachedAt < SP500_CACHE_MS) return sp500Cache
    try {
      const data = await deps.http.getJson<unknown>('/api/v1/stocks/sp500')
      sp500Cache = Array.isArray(data) ? (data as Sp500Stock[]) : []
      sp500CachedAt = now()
      return sp500Cache
    } catch (e) {
      // 캐시가 없으면 실패를 알린다. 빈 목록이면 화면이 실패와 "목록 없음" 을 구분하지 못한다.
      console.warn('[market] S&P 500 목록 조회 실패:', e)
      if (!sp500Cache) throw e
      return sp500Cache
    }
  })

  async function fetchPriceSnapshot(): Promise<StockPriceEntry[]> {
    try {
      const data = await deps.http.getJson<unknown>('/api/v1/stocks/prices')
      return Array.isArray(data) ? (data as StockPriceEntry[]) : []
    } catch (e) {
      console.warn('[market] 주가 스냅샷 조회 실패:', e)
      return []
    }
  }
  registry.handle(IPC_CHANNELS.STOCK_PRICES_SNAPSHOT_GET, fetchPriceSnapshot)

  /** /topic/prices 로 받은 마지막 값. 스냅샷 응답이 이보다 오래됐으면 이 값을 쓴다. */
  const livePrices = new Map<string, PriceEntry>()

  // 터미널 PRICES_GET 은 main 의 시세 캐시(Record<ticker, { currentPrice, previousClose, lastUpdated }>)를 준다.
  // 웹에는 그 캐시가 없어 스냅샷 REST 를 같은 모양으로 바꿔 준다.
  // 실패하면 reject 한다. 빈 값을 주면 usePrices 가 store 를 통째로 바꿔 이미 보이던 시세가 사라진다.
  registry.handle(IPC_CHANNELS.PRICES_GET, async () => {
    const data = await deps.http.getJson<unknown>('/api/v1/stocks/prices')
    const out: Record<string, PriceEntry> = {}
    for (const entry of Array.isArray(data) ? (data as StockPriceEntry[]) : []) {
      if (typeof entry?.ticker !== 'string' || typeof entry.currentPrice !== 'number') continue
      out[entry.ticker] = {
        currentPrice: entry.currentPrice,
        previousClose: typeof entry.previousClose === 'number' ? entry.previousClose : 0,
        lastUpdated: entry.updatedAt,
      }
    }
    // 요청을 보낸 뒤 응답 전에 실시간으로 받은 값이 더 새것일 수 있다
    for (const [ticker, live] of livePrices) {
      const snapshot = out[ticker]
      if (!snapshot || !(snapshot.lastUpdated > live.lastUpdated)) out[ticker] = live
    }
    return out
  })

  // StompService 와 같은 변환: updatedAt → lastUpdated, 빈 배열은 버린다.
  registry.source(IPC_CHANNELS.PRICES_UPDATE, () =>
    subscribeTopic('/topic/prices', (payload) => {
      if (!Array.isArray(payload) || payload.length === 0) return
      const batch = (payload as StockPriceEntry[]).map((u) => ({
        ticker: u.ticker,
        currentPrice: u.currentPrice,
        previousClose: u.previousClose,
        lastUpdated: u.updatedAt,
      }))
      for (const { ticker, ...entry } of batch) livePrices.set(ticker, entry)
      registry.emit(IPC_CHANNELS.PRICES_UPDATE, batch)
    }),
  )

  // ── 종목 상세 ──────────────────────────────────────────────────────────────
  const detailCache = new Map<string, { payload: StockDetailResponsePayload; fetchedAt: number }>()
  registry.handle(IPC_CHANNELS.STOCK_GET_DETAIL, async (payload) => {
    const ticker = (payload as { ticker?: unknown } | null | undefined)?.ticker
    if (typeof ticker !== 'string' || !DETAIL_TICKER.test(ticker)) throw new IpcError('VALIDATION', 'invalid ticker')
    const cached = detailCache.get(ticker)
    if (cached) {
      const ttl = cached.payload.partial ? DETAIL_PARTIAL_TTL_MS : DETAIL_TTL_MS
      if (now() - cached.fetchedAt < ttl) return cached.payload
    }
    const fresh = await deps.http.getJson<StockDetailResponsePayload>(`/api/v1/stocks/${encodeURIComponent(ticker)}/detail`)
    detailCache.set(ticker, { payload: fresh, fetchedAt: now() })
    return fresh
  })

  function subscribeTopic(destination: string, onPayload: (payload: unknown) => void): () => void {
    deps.stomp.subscribe(destination, (body) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch (e) {
        console.error(`[market] ${destination} 메시지 파싱 실패:`, e)
        return
      }
      onPayload(parsed)
    })
    void deps.stomp.connect()
    return () => deps.stomp.unsubscribe(destination)
  }
}
