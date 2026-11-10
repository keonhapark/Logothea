import type { HttpClient } from '../data/http'
import type { StompBridge, WsStatus } from '../data/stomp'

/**
 * 개발용 가짜 서버. `.env.development.local` 에 `VITE_FIXTURES=1` 을 두면 runtime.ts 가 실서버 대신 이것을 쓴다.
 * 백엔드 없이 화면을 그려 보고 캡처하는 용도다. 배포용 빌드에서는 import.meta.env.DEV 가 false 라 쓰이지 않고
 * 번들에서 빠진다. 숫자 · 발언은 모두 예시다.
 */

const now = () => Math.floor(Date.now() / 1000)
const CALL_ID = 'demo-wmt-fixture-1'

const STOCKS: [string, string, string, number, number, number][] = [
  // ticker, name, sector, 시가총액(B), 가격, 등락률
  ['NVDA', 'NVIDIA Corp.', 'Information Technology', 4400, 181.2, 2.1],
  ['MSFT', 'Microsoft Corp.', 'Information Technology', 3800, 512.4, 0.5],
  ['AAPL', 'Apple Inc.', 'Information Technology', 3500, 231.8, -0.7],
  ['AVGO', 'Broadcom Inc.', 'Information Technology', 1400, 302.1, 1.4],
  ['ORCL', 'Oracle Corp.', 'Information Technology', 700, 245.6, -1.9],
  ['GOOGL', 'Alphabet Inc.', 'Communication Services', 2300, 201.3, 1.2],
  ['META', 'Meta Platforms', 'Communication Services', 1900, 752.1, -0.3],
  ['NFLX', 'Netflix Inc.', 'Communication Services', 520, 1210.5, 0.4],
  ['AMZN', 'Amazon.com Inc.', 'Consumer Discretionary', 2400, 228.4, 0.8],
  ['TSLA', 'Tesla Inc.', 'Consumer Discretionary', 1100, 340.2, -2.6],
  ['HD', 'Home Depot Inc.', 'Consumer Discretionary', 400, 402.3, 0.1],
  ['WMT', 'Walmart Inc.', 'Consumer Staples', 790, 98.42, 1.2],
  ['COST', 'Costco Wholesale', 'Consumer Staples', 420, 946.7, 0.2],
  ['PG', 'Procter & Gamble', 'Consumer Staples', 370, 158.1, -0.4],
  ['JPM', 'JPMorgan Chase', 'Financials', 820, 296.4, -0.6],
  ['V', 'Visa Inc.', 'Financials', 670, 345.0, 0.3],
  ['MA', 'Mastercard Inc.', 'Financials', 540, 585.2, 0.0],
  ['LLY', 'Eli Lilly', 'Health Care', 690, 772.5, 1.1],
  ['UNH', 'UnitedHealth Group', 'Health Care', 300, 330.8, -1.2],
  ['JNJ', 'Johnson & Johnson', 'Health Care', 420, 176.4, 0.6],
  ['XOM', 'Exxon Mobil', 'Energy', 480, 112.3, 0.0],
  ['CAT', 'Caterpillar Inc.', 'Industrials', 210, 433.1, 0.9],
  ['GE', 'GE Aerospace', 'Industrials', 290, 271.5, 1.6],
  ['LIN', 'Linde plc', 'Materials', 220, 470.2, -0.2],
  ['NEE', 'NextEra Energy', 'Utilities', 150, 73.9, 0.7],
  ['PLD', 'Prologis Inc.', 'Real Estate', 100, 108.2, -0.5],
]

function sp500() {
  return STOCKS.map(([ticker, companyName, sector, capB, price, pct], i) => ({
    ticker,
    companyName,
    sector,
    marketCapUsd: capB * 1e9,
    marketCapRank: i + 1,
    currentPrice: price,
    previousClose: +(price / (1 + pct / 100)).toFixed(2),
    changePercent: pct,
  }))
}

function prices() {
  return sp500().map((s) => ({
    ticker: s.ticker,
    currentPrice: s.currentPrice,
    previousClose: s.previousClose,
    changePercent: s.changePercent,
    updatedAt: Date.now(),
  }))
}

function timeline() {
  const t = now()
  const rows: [string, string, number, string][] = [
    ['HD', 'Home Depot Inc.', 3600 * 3, 'bmo'],
    ['TGT', 'Target Corp.', 3600 * 5, 'bmo'],
    ['NVDA', 'NVIDIA Corp.', 3600 * 26, 'amc'],
    ['LOW', "Lowe's Companies", 3600 * 30, 'bmo'],
    ['TJX', 'TJX Companies', 3600 * 50, 'bmo'],
    ['ROST', 'Ross Stores', 3600 * 55, 'amc'],
    ['INTU', 'Intuit Inc.', 3600 * 80, 'amc'],
    ['DE', 'Deere & Co.', 3600 * 100, 'bmo'],
    ['ADI', 'Analog Devices', 3600 * 130, 'bmo'],
    ['ZM', 'Zoom Communications', 3600 * 150, 'amc'],
    ['DELL', 'Dell Technologies', 3600 * 170, 'amc'],
    ['CRM', 'Salesforce Inc.', 3600 * 200, 'amc'],
    ['MRVL', 'Marvell Technology', 3600 * 220, 'amc'],
  ]
  return rows.map(([ticker, companyName, offset, marketSession]) => ({
    ticker,
    companyName,
    scheduledAt: t + offset,
    confirmed: true,
    marketSession,
  }))
}

function detail(ticker: string) {
  const s = sp500().find((x) => x.ticker === ticker)
  const base = s?.currentPrice ?? 100
  const chart30d = Array.from({ length: 22 }, (_, i) => ({
    date: new Date(Date.now() - (21 - i) * 86400000).toISOString().slice(0, 10),
    close: +(base * (0.95 + i * 0.0025 + Math.sin(i / 2) * 0.01)).toFixed(2),
    volume: null,
  }))
  return {
    ticker,
    companyName: s?.companyName ?? ticker,
    sector: s?.sector ?? null,
    active: s != null,
    basic: { marketCapUsd: s?.marketCapUsd ?? null, high52w: +(base * 1.18).toFixed(2), low52w: +(base * 0.74).toFixed(2), dividendYield: 0.0094 },
    chart30d,
    currentPrice: base,
    earningsHistory: [
      { fiscalPeriodLabel: '26Q1', announcedAt: now() - 90 * 86400, epsEstimate: 0.61, epsActual: 0.58, surprisePercent: -4.9, priceReactionPercent: -2.2 },
      { fiscalPeriodLabel: '25Q4', announcedAt: now() - 180 * 86400, epsEstimate: 0.65, epsActual: 0.66, surprisePercent: 1.5, priceReactionPercent: -1.4 },
      { fiscalPeriodLabel: '25Q3', announcedAt: now() - 270 * 86400, epsEstimate: 0.58, epsActual: 0.6, surprisePercent: 3.4, priceReactionPercent: 3.1 },
      { fiscalPeriodLabel: '25Q2', announcedAt: now() - 360 * 86400, epsEstimate: 0.64, epsActual: 0.68, surprisePercent: 6.2, priceReactionPercent: 6.6 },
    ],
    nextEarning: { scheduledAt: ticker === 'WMT' ? now() - 1100 : now() + 20 * 86400, epsEstimate: 0.73, revenueEstimate: 177.2e9, confirmed: true },
    partial: false,
    ai: null,
  }
}

const SCRIPT: [string, string, string][] = [
  ['CEO · Doug McMillon', 'Good morning, and thank you for joining us.', '좋은 아침입니다. 함께해 주셔서 감사합니다.'],
  ['CEO · Doug McMillon', 'We grew comparable sales 4.6% in the U.S., with transactions up across income cohorts.', '미국 기존점 매출이 4.6% 늘었고, 모든 소득 계층에서 거래 건수가 늘었습니다.'],
  ['CEO · Doug McMillon', 'eCommerce grew 25% globally and was profitable again this quarter.', '전자상거래는 전 세계에서 25% 성장했고 이번 분기에도 흑자를 냈습니다.'],
  ['CFO · John David Rainey', 'We now expect full-year EPS toward the lower end of our range, reflecting tariff costs.', '관세 비용을 반영해 연간 EPS 는 전망 범위 하단을 예상합니다.'],
]

function segment(i: number, startedAt: number) {
  const [speaker, text] = SCRIPT[i % SCRIPT.length]
  return {
    ticker: 'WMT',
    call_id: CALL_ID,
    sequence: i,
    start_ms: i * 70_000,
    end_ms: i * 70_000 + 65_000,
    text,
    speaker,
    timestamp: startedAt + i,
  }
}

export function createFixtureHttp(): Pick<HttpClient, 'getJson'> & Pick<HttpClient, 'request'> {
  const routes: [RegExp, (m: RegExpMatchArray) => unknown][] = [
    [/^\/api\/v1\/stocks\/sp500/, () => sp500()],
    [/^\/api\/v1\/stocks\/prices/, () => prices()],
    [/^\/api\/v1\/stocks\/([A-Z.]+)\/detail/, (m) => detail(m[1])],
    [/^\/api\/v1\/market\/indices/, () => [
      { symbol: 'SPX', price: 6512.3, change_percent: 0.42, trend: 'up', format: 'index', timestamp: now() },
      { symbol: 'NDX', price: 21880.4, change_percent: 0.61, trend: 'up', format: 'index', timestamp: now() },
      { symbol: 'VIX', price: 15.2, change_percent: -3.1, trend: 'down', format: 'index', timestamp: now() },
    ]],
    [/^\/api\/v1\/earnings-calendar\/terminal-timeline/, () => timeline()],
    [/^\/api\/v1\/demo\/earnings-call\/status/, () => ({ running: true, ticker: 'WMT', call_id: CALL_ID, published_count: 4, total_segments: 24 })],
    [/^\/api\/v1\/demo\/earnings-call\/speakers/, () => [
      { name: 'Doug McMillon', match_key: 'CEO · Doug McMillon', title: 'CEO', affiliation: 'Walmart Inc.', analyst: false },
      { name: 'John David Rainey', match_key: 'CFO · John David Rainey', title: 'CFO', affiliation: 'Walmart Inc.', analyst: false },
    ]],
    [/^\/api\/v1\/glossary/, () => ({
      version: 'fixture',
      terms: [{ term: 'comparable sales', aliases: ['comp sales'], ko: '기존점 매출', definition_ko: '1년 넘게 문을 연 매장만 놓고 작년 같은 기간과 비교한 매출 증가율입니다.', category: 'metric' }],
    })],
  ]
  return {
    async getJson<T>(path: string): Promise<T> {
      await new Promise((r) => setTimeout(r, 250))
      for (const [pattern, handler] of routes) {
        const m = path.match(pattern)
        if (m) return handler(m) as T
      }
      throw new Error(`fixture: ${path}`)
    },
    async request() {
      return new Response(JSON.stringify({ error: '개발용 가짜 서버는 질문을 받지 않습니다.' }), { status: 503 })
    },
  }
}

export function createFixtureStomp(): StompBridge {
  const handlers = new Map<string, (body: string) => void>()
  const statusListeners = new Set<(s: WsStatus) => void>()
  let status: WsStatus = 'DISCONNECTED'
  let started = false
  const startedAt = now() - 1200

  const push = (topic: string, payload: unknown) => handlers.get(topic)?.(JSON.stringify(payload))
  const start = () => {
    if (started) return
    started = true
    // 앞 회차 일부를 바로 채우고, 이후 6초마다 한 문장씩
    let i = 0
    const next = () => {
      if (i >= SCRIPT.length) return
      push('/topic/transcript/WMT', segment(i, startedAt))
      const [, , ko] = SCRIPT[i]
      push('/topic/transcript-translation/WMT', { ticker: 'WMT', call_id: CALL_ID, sequences: [i], text_ko: ko, terms_used: i === 1 ? ['comparable sales'] : [] })
      i++
    }
    setTimeout(() => {
      next()
      next()
      next()
      push('/topic/transcript-diff/WMT', {
        ticker: 'WMT',
        call_id: CALL_ID,
        sequence: 1,
        previous_document: { document_id: 'prev', title: 'Q1', published_at: '2026-05-15', fiscal_quarter: '2026년 1분기', source_url: '' },
        items: [{ topic: '수요', change_type: 'improved', summary_ko: '거래 건수 증가를 처음으로 전 소득층에서 확인했습니다.', current_claim: 'transactions up across income cohorts', prior_claim: 'transactions grew', confidence: 0.8, risk_score: 0.2, evidence: [] }],
      })
    }, 600)
    setInterval(next, 6000)
  }

  const setStatus = (next: WsStatus) => {
    status = next
    for (const l of statusListeners) l(next)
  }

  return {
    get status() {
      return status
    },
    async connect() {
      if (status === 'CONNECTED') return
      setStatus('CONNECTED')
      start()
    },
    async reconnectNow() {},
    disconnect() {
      setStatus('DISCONNECTED')
    },
    subscribe(destination, handler) {
      handlers.set(destination, handler)
    },
    unsubscribe(destination) {
      handlers.delete(destination)
    },
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
  }
}
