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

/**
 * 화면 확인용 상태. 개발 서버 주소에 `?fixture=ended-wait`(콜 종료 · 판단 대기) · `?fixture=ended`(판단 도착)를 붙이거나
 * 붙이지 않으면 진행 중인 콜이다.
 */
function fixtureMode(): 'live' | 'ended-wait' | 'ended' {
  const m = new URLSearchParams(window.location.search).get('fixture')
  return m === 'ended' || m === 'ended-wait' ? m : 'live'
}

const SCRIPT: [string, string, string, string[]][] = [
  ['CEO · Doug McMillon', 'Good morning, and thank you for joining us.', '좋은 아침입니다. 함께해 주셔서 감사합니다.', []],
  ['CEO · Doug McMillon', 'We grew comparable sales 4.6% in the U.S., with transactions up across income cohorts.', '미국 기존점 매출이 4.6% 늘었고, 모든 소득 계층에서 거래 건수가 늘었습니다.', ['comparable sales']],
  ['CEO · Doug McMillon', 'eCommerce grew 25% globally and was profitable again this quarter.', '전자상거래는 전 세계에서 25% 성장했고 이번 분기에도 흑자를 냈습니다.', []],
  ['CFO · John David Rainey', 'We now expect full-year EPS toward the lower end of our range, reflecting tariff costs.', '관세 비용을 반영해 연간 EPS 는 전망 범위 하단을 예상합니다.', ['guidance']],
  ['Kate McShane', 'Can you talk about how tariffs are affecting pricing decisions in grocery?', '관세가 식료품 가격 결정에 어떤 영향을 주고 있는지 말씀해 주시겠습니까?', []],
  ['CEO · Doug McMillon', 'We are working with suppliers to keep prices low, and we are moving some sourcing.', '공급사와 함께 가격을 낮게 유지하려 하고 있으며 일부 조달처를 옮기고 있습니다.', []],
]

const DIFFS: Record<number, { topic: string; change_type: string; summary_ko: string; current_claim: string; prior_claim: string; confidence: number; risk_score: number }> = {
  1: { topic: 'demand', change_type: 'improved', summary_ko: '거래 건수 증가를 모든 소득 계층에서 확인했습니다.', current_claim: 'transactions up across income cohorts', prior_claim: 'transactions grew, led by higher-income households', confidence: 0.82, risk_score: 0.2 },
  3: { topic: 'guidance', change_type: 'weakened', summary_ko: '연간 EPS 전망을 상향에서 범위 하단으로 낮췄습니다.', current_claim: '…toward the lower end of our range, reflecting tariff costs.', prior_claim: 'We are raising our full-year EPS guidance.', confidence: 0.86, risk_score: 0.78 },
  5: { topic: 'supply', change_type: 'new_claim', summary_ko: '관세 대응으로 일부 조달처를 옮기고 있다고 처음 언급했습니다.', current_claim: 'we are moving some sourcing', prior_claim: '', confidence: 0.7, risk_score: 0.35 },
}

function segment(i: number, startedAt: number, end = false) {
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
    ...(end ? { is_session_end: true } : {}),
  }
}

const EVALUATION = {
  ticker: 'WMT',
  call_id: CALL_ID,
  generated_at: new Date().toISOString(),
  judgment: { direction: 'BEARISH', magnitude: 0.42, confidence: 0.68, catalyst_type: 'GUIDANCE', rationale: 'Management lowered full-year EPS expectations toward the low end citing tariff costs, offsetting strong comparable sales.', risk_flags: [], hold_days: 5, model_version: 'fixture-model' },
  gate: { action: 'WATCH', gate_result: 'soft_block', institutional_grade: 'B', institutional_grade_score: 64, position_intent_ko: '가이던스 하향을 확인하기 전까지 지켜봅니다.', no_trade_summary_ko: '수요는 강하지만 이익 전망이 낮아졌습니다.', risk_flags_ko: ['관세 비용 확대'], counter_thesis_ko: '기존점 매출과 전자상거래 흑자가 이익 하향을 상쇄할 수 있습니다.' },
  evasion: { evasion_score: 0.31, directness: 0.7, pivot_detected: false, missing_topics: ['가격 인상 폭'], rationale_ko: '관세 질문에 구체적인 가격 인상 폭은 답하지 않았습니다.' },
  impact_chain: [{ ticker: 'COST', relationship: 'retail peer', direction: 'negative', impact_score: 0.4, confidence: 0.6, rationale_ko: '같은 관세 비용 노출' }],
  risk_plan: { available: true, direction: 'SHORT', reference_price: 98.42, stop_loss: 101.4, take_profit_1: 95.0, take_profit_2: 92.5, stop_pct: 3.0, take_profit_1_pct: -3.5, take_profit_2_pct: -6.0, risk_reward_1: 1.2, time_stop_days: 5, invalidation_text: '주가가 직전 고점을 넘으면 무효' },
  warnings: [],
  intelligence_available: true,
}

const encoder = new TextEncoder()
function sseAnswer(): Response {
  const frames = [
    'event:meta\ndata:{"scope":"call","as_of_sequence":3,"as_of_time":"","anchor_sequence":null,"missing_sources":[]}\n\n',
    'event:delta\ndata:{"text":"CFO는 관세로 늘어난 비용을 이유로 들었습니다 [S3]. "}\n\n',
    'event:delta\ndata:{"text":"직전 콜에서는 연간 EPS 전망을 올렸는데, 이번에는 범위 하단을 예상한다고 말해 방향이 바뀌었습니다 [P1]."}\n\n',
    'event:citations\ndata:[{"marker":"S3","type":"segment","ref":"3","title":null,"source":null,"published_at":null,"start_ms":210000,"speaker":"CFO · John David Rainey","quote":"…toward the lower end of our range, reflecting tariff costs.","verified":true},{"marker":"P1","type":"prior_statement","ref":null,"title":"2026년 1분기 콜","source":"Walmart","published_at":1747267200,"start_ms":null,"speaker":null,"quote":"We are raising our full-year EPS guidance.","verified":true}]\n\n',
    'event:done\ndata:{"status":"answered","warnings":[]}\n\n',
  ]
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const f of frames) {
        await new Promise((r) => setTimeout(r, 400))
        controller.enqueue(encoder.encode(f))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
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
    [/^\/api\/v1\/demo\/earnings-call\/status/, () =>
      fixtureMode() === 'live'
        ? { running: true, ticker: 'WMT', call_id: CALL_ID, published_count: 4, total_segments: 24 }
        : { running: false, ticker: 'WMT', last_run: { call_id: CALL_ID, outcome: 'COMPLETED', published_count: 6, total_segments: 6 } }],
    [/^\/api\/v1\/demo\/earnings-call\/speakers/, () => [
      { name: 'Doug McMillon', match_key: 'CEO · Doug McMillon', title: 'CEO', affiliation: 'Walmart Inc.', analyst: false },
      { name: 'John David Rainey', match_key: 'CFO · John David Rainey', title: 'CFO', affiliation: 'Walmart Inc.', analyst: false },
      { name: 'Kate McShane', match_key: 'Kate McShane', title: 'Analyst', affiliation: 'Goldman Sachs', analyst: true },
    ]],
    [/^\/api\/v1\/glossary/, () => ({
      version: 'fixture',
      terms: [
        { term: 'comparable sales', aliases: ['comp sales'], ko: '기존점 매출', definition_ko: '1년 넘게 문을 연 매장만 놓고 작년 같은 기간과 비교한 매출 증가율입니다. 새 매장을 열어서 늘어난 몫을 빼기 때문에, 원래 있던 가게에서 손님이 더 많이 사고 있는지를 보여 줍니다.', why_ko: '어닝콜에서 이 숫자가 오르면 회사의 기본 장사가 좋아지고 있다는 뜻으로 읽힙니다.', category: 'metric' },
        { term: 'guidance', aliases: [], ko: '전망', definition_ko: '회사가 앞으로의 실적을 스스로 내다본 숫자입니다.', why_ko: '전망을 낮추면 경영진이 앞날을 조심스럽게 본다는 신호로 읽힙니다.', category: 'metric' },
      ],
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
    async request(path: string) {
      if (path.startsWith('/api/v1/assistant/ask')) return sseAnswer()
      return new Response(JSON.stringify({ error: 'fixture' }), { status: 404 })
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
    const mode = fixtureMode()
    let i = 0
    const next = (end = false) => {
      if (i >= SCRIPT.length) return
      push('/topic/transcript/WMT', segment(i, startedAt, end))
      const [, , ko, terms] = SCRIPT[i]
      push('/topic/transcript-translation/WMT', { ticker: 'WMT', call_id: CALL_ID, sequences: [i], text_ko: ko, terms_used: terms })
      const diff = DIFFS[i]
      if (diff) {
        push('/topic/transcript-diff/WMT', {
          ticker: 'WMT',
          call_id: CALL_ID,
          sequence: i,
          previous_document: { document_id: 'prev', title: 'Q1', published_at: '2026-05-15', fiscal_quarter: '2026년 1분기', source_url: '' },
          items: [{ ...diff, evidence: [] }],
        })
      }
      i++
    }
    setTimeout(() => {
      if (mode === 'live') {
        for (let k = 0; k < 4; k++) next()
        setInterval(() => next(), 8000)
        return
      }
      while (i < SCRIPT.length) next(i === SCRIPT.length - 1)
      if (mode === 'ended') setTimeout(() => push('/topic/evaluation/WMT', EVALUATION), 300)
    }, 600)
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
