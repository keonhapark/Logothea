import { useCompanyDetail } from '@terminal/renderer/hooks/useCompanyDetail'
import { usePricesStore } from '@terminal/renderer/store/usePricesStore'
import { epsBulletDomain, epsBulletRatio } from '@terminal/renderer/lib/callScreen'
import { sectorLabel } from '@terminal/renderer/lib/marketMap'
import {
  dDayLabel,
  formatDividendYield,
  formatEpsEstimate,
  formatMarketCap,
  formatPeriodChangeLabel,
  formatPrice,
  formatRevenue,
  pickChartDirection,
} from '@terminal/renderer/lib/companyDetailFormatters'
import type { StockDetailResponsePayload } from '@terminal/lib/types/stockDetail'
import { closeSheetAndGo, openSheet } from '../app/sheet'
import { BROADCAST_TICKER, useBroadcastView } from '../app/broadcast'
import { kstFullDateTime } from '../lib/format'

/**
 * 종목 브리핑(긴 시트). 데스크톱 CompanyDrawer(components/dashboard/CompanyDrawer.tsx)를 모바일 한 열로 다시 만들었다.
 * 순서: 머리 → 이번/다음 실적 발표 → 최근 어닝 반응 → 30일 종가 → 기본 정보. `관심 추가` 는 없다.
 * 맨 아래 `콜 보기` 는 지금 방송 중인 종목에만 둔다.
 */
export function openBrief(ticker: string): void {
  openSheet({
    title: `${ticker} 종목 브리핑`,
    hideTitle: true,
    size: 'tall',
    body: () => <BriefBody ticker={ticker} />,
    footer: () => <BriefFooter ticker={ticker} />,
  })
}

function BriefFooter({ ticker }: { ticker: string }) {
  const live = useBroadcastView().kind === 'live'
  if (ticker !== BROADCAST_TICKER || !live) return null
  return (
    <button type="button" className="cta tint" onClick={() => closeSheetAndGo('/call')}>
      콜 보기
    </button>
  )
}

function BriefBody({ ticker }: { ticker: string }) {
  const { data, loading, error } = useCompanyDetail(ticker)
  const live = usePricesStore((s) => s.prices[ticker])

  if (loading || (!data && !error)) {
    return (
      <>
        <BriefHead ticker={ticker} />
        <div className="brief-sec" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      </>
    )
  }
  if (error || !data) {
    return (
      <>
        <BriefHead ticker={ticker} />
        <p className="brief-muted">종목 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
      </>
    )
  }

  const price = live?.currentPrice ?? data.currentPrice
  const prevClose = live?.previousClose || closeBefore(data)
  return (
    <>
      <BriefHead ticker={ticker} data={data} price={price} prevClose={prevClose} isLive={live != null} />
      <NextEarning data={data} />
      <EarningsReaction data={data} />
      <Chart30d data={data} />
      <BasicInfo data={data} />
    </>
  )
}

/** 실시간 시세가 없을 때 등락 기준: 30일 종가의 끝에서 두 번째 값. */
function closeBefore(data: StockDetailResponsePayload): number | null {
  const n = data.chart30d.length
  return n >= 2 ? data.chart30d[n - 2].close : null
}

function BriefHead({
  ticker,
  data,
  price,
  prevClose,
  isLive,
}: {
  ticker: string
  data?: StockDetailResponsePayload
  price?: number | null
  prevClose?: number | null
  isLive?: boolean
}) {
  const diff = price != null && prevClose ? price - prevClose : null
  const pct = diff != null && prevClose ? (diff / prevClose) * 100 : null
  const dir = diff == null || diff === 0 ? '' : diff > 0 ? 'up' : 'down'
  return (
    <div className="brief-head">
      <span className="brief-logo cloud-s" aria-hidden="true">
        {ticker.charAt(0)}
      </span>
      <span className="brief-name">
        <b>{ticker}</b>
        <span>
          {data ? [data.companyName, data.sector ? sectorLabel(data.sector) : null].filter(Boolean).join(' · ') : ' '}
        </span>
        {data && (!data.active || data.partial) && (
          <span className="brief-tags">
            {!data.active && <span>지원 외</span>}
            {data.partial && <span>일부 동기화 중</span>}
          </span>
        )}
      </span>
      {data && (
        <span className="brief-px">
          <b className="tnum">{formatPrice(price ?? null)}</b>
          {diff != null && pct != null ? (
            <span className={`tnum ${dir}`}>
              {diff >= 0 ? '+' : '−'}
              {Math.abs(diff).toFixed(2)} ({pct >= 0 ? '+' : '−'}
              {Math.abs(pct).toFixed(1)}%)
            </span>
          ) : (
            <span className="brief-muted-sm">등락 정보 없음</span>
          )}
          {isLive && <span className="brief-muted-sm">실시간</span>}
        </span>
      )}
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="brief-sec">
      <h3 className="brief-k">
        <span>{title}</span>
        {aside}
      </h3>
      {children}
    </section>
  )
}

const NOT_SUPPORTED = '어닝 분석은 S&P 500 종목만 지원합니다.'
const NOT_YET = '아직 받지 못했습니다.'

function NextEarning({ data }: { data: StockDetailResponsePayload }) {
  const broadcast = useBroadcastView()
  const onAir = data.ticker === BROADCAST_TICKER && broadcast.kind === 'live'
  const next = data.nextEarning
  const title = onAir ? '이번 실적 발표' : '다음 실적 발표'
  if (!data.active) {
    return (
      <Section title={title}>
        <p className="brief-muted">{NOT_SUPPORTED}</p>
      </Section>
    )
  }
  const aside = onAir ? (
    <span className="live">
      <i />
      방송 중
    </span>
  ) : next ? (
    <span className="tnum">
      {dDayLabel(next.scheduledAt)} · {next.confirmed ? '확정' : '예정'}
    </span>
  ) : null
  return (
    <Section title={title} aside={aside}>
      {next ? (
        <>
          {!onAir && <p className="brief-line">{kstFullDateTime(next.scheduledAt)} · 한국 시간</p>}
          <div className="brief-kv">
            <div className="cloud-s">
              EPS 기대치<b className="tnum">{formatEpsEstimate(next.epsEstimate)}</b>
            </div>
            <div className="cloud-s">
              매출 기대치<b className="tnum">{formatRevenue(next.revenueEstimate)}</b>
            </div>
          </div>
        </>
      ) : (
        <p className="brief-muted">{NOT_YET}</p>
      )}
    </Section>
  )
}

const BAR_MAX = 52

function EarningsReaction({ data }: { data: StockDetailResponsePayload }) {
  if (!data.active) {
    return (
      <Section title="최근 어닝 반응">
        <p className="brief-muted">{NOT_SUPPORTED}</p>
      </Section>
    )
  }
  // 응답은 최근 분기부터 온다. 왼쪽이 오래된 분기가 되도록 뒤집는다.
  const rows = data.earningsHistory.slice(0, 4).reverse()
  const domain = epsBulletDomain(rows.flatMap((r) => [r.epsEstimate, r.epsActual]))
  return (
    <Section title="최근 어닝 반응" aside={<span>막대 실제 · 금선 예상</span>}>
      {rows.length === 0 || !domain ? (
        <p className="brief-muted">{NOT_YET}</p>
      ) : (
        <ol className="brief-eps">
          {rows.map((row) => {
            const actual = row.epsActual
            const estimate = row.epsEstimate
            const beat = actual != null && estimate != null ? actual >= estimate : null
            const height = actual != null ? Math.max(4, epsBulletRatio(actual, domain) * BAR_MAX) : 4
            const estTop = estimate != null ? BAR_MAX - epsBulletRatio(estimate, domain) * BAR_MAX : null
            const reaction = row.priceReactionPercent
            const label = `${row.fiscalPeriodLabel}: 실제 EPS ${actual ?? '정보 없음'}, 예상 ${estimate ?? '정보 없음'}${
              beat == null ? '' : beat ? ', 예상 이상' : ', 예상 미달'
            }, 발표일 주가 ${reaction == null ? '정보 없음' : `${reaction >= 0 ? '+' : ''}${reaction.toFixed(1)}%`}`
            return (
              <li key={`${row.fiscalPeriodLabel}-${row.announcedAt}`} aria-label={label}>
                <span className="brief-eps-track" aria-hidden="true">
                  <span
                    className="brief-eps-bar"
                    style={{
                      height,
                      background: beat == null ? 'rgb(var(--ink-rgb) / 0.14)' : beat ? 'var(--olive)' : 'var(--porphyra)',
                    }}
                  />
                  {estTop != null && <span className="brief-eps-est" style={{ top: estTop }} />}
                </span>
                <span aria-hidden="true">{row.fiscalPeriodLabel}</span>
                <span
                  aria-hidden="true"
                  className={`tnum brief-eps-r ${reaction == null || reaction === 0 ? '' : reaction > 0 ? 'up' : 'down'}`}
                >
                  {reaction == null ? '—' : `${reaction > 0 ? '+' : reaction < 0 ? '−' : ''}${Math.abs(reaction).toFixed(1)}%`}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}

function Chart30d({ data }: { data: StockDetailResponsePayload }) {
  const points = data.chart30d.filter((p) => Number.isFinite(p.close))
  const dir = pickChartDirection(points)
  const change = formatPeriodChangeLabel(points)
  const color = dir === 'up' ? 'rgb(var(--up-rgb))' : dir === 'down' ? 'rgb(var(--down-rgb))' : 'var(--ink-2)'
  if (points.length < 2) {
    return (
      <Section title="30일 종가">
        <p className="brief-muted">차트 데이터를 아직 받지 못했습니다.</p>
      </Section>
    )
  }
  const W = 300
  const H = 56
  const closes = points.map((p) => p.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const xy = closes.map((c, i) => [(i / (closes.length - 1)) * W, 4 + (1 - (c - min) / span) * (H - 8)] as const)
  const d = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <Section title="30일 종가" aside={change ? <span className={`tnum ${dir === 'neutral' ? '' : dir}`}>{change}</span> : null}>
      <svg viewBox={`0 0 ${W} ${H}`} className="brief-chart" preserveAspectRatio="none" role="img" aria-label={`30일 종가 ${change || ''}`}>
        <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lx} cy={ly} r="3" fill={color} />
      </svg>
    </Section>
  )
}

function BasicInfo({ data }: { data: StockDetailResponsePayload }) {
  const basic = data.basic
  return (
    <Section title="기본 정보">
      {basic ? (
        <dl className="brief-dl">
          <div>
            <dt>섹터</dt>
            <dd>{data.sector ? sectorLabel(data.sector) : '—'}</dd>
          </div>
          <div>
            <dt>시가총액</dt>
            <dd className="tnum">{formatMarketCap(basic.marketCapUsd)}</dd>
          </div>
          <div>
            <dt>52주 고가 / 저가</dt>
            <dd className="tnum">
              {formatPrice(basic.high52w)} / {formatPrice(basic.low52w)}
            </dd>
          </div>
          <div>
            <dt>배당수익률</dt>
            <dd className="tnum">{formatDividendYield(basic.dividendYield)}</dd>
          </div>
        </dl>
      ) : (
        <p className="brief-muted">기본 정보를 아직 받지 못했습니다.</p>
      )}
    </Section>
  )
}
