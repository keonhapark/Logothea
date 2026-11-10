// from https://github.com/Seokwoooo/lucian-uxui-prompt/blob/42396145b375a17712fd738ca0e1d977556c0b73/src/elements/165-forecast-band.html @ 42396145b375a17712fd738ca0e1d977556c0b73 · MIT (c) 2026 Seokwoooo
import { useMemo, useState } from 'react'
import type { PricePoint } from '../../types/priceSeries'
import { isUsablePrice, riskBandLayout, spreadLabels, type BandKey, type RiskBand } from '../../lib/riskBand'

interface RiskBandChartProps {
  series: readonly PricePoint[]
  referencePrice: number | null
  stopLoss: number | null
  takeProfit1: number | null
  takeProfit2: number | null
  /** 엔진이 준 기준가 대비 비율(%). 아래 숫자 표와 같은 값을 쓰려고 받는다. 없으면 직접 계산한다. */
  stopPct?: number | null
  takeProfit1Pct?: number | null
  takeProfit2Pct?: number | null
  /** 띠를 앞으로 펴는 날 수. 시간 손절이 있으면 그 날 수, 없으면 10일. */
  days: number | null
}

const W = 640
const H = 200
const PAD = { l: 8, r: 112, t: 12, b: 22 }

const BAND_META: Record<BandKey, { label: string; color: string; fill: number }> = {
  stop: { label: '손절', color: 'var(--porphyra-ink)', fill: 0.16 },
  tp1: { label: '1차 익절', color: 'var(--olive-ink)', fill: 0.16 },
  tp2: { label: '2차 익절', color: 'var(--olive-ink)', fill: 0.09 },
}

const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

function describe(b: RiskBand, basis: string, pct: number): string {
  const dist = `${basis}보다 ${money(Math.abs(b.diff))}(${signed(pct)}%) ${b.diff < 0 ? '아래' : '위'}`
  return b.key === 'stop'
    ? `${BAND_META.stop.label} ${money(b.price)} · ${dist}. 종가가 여기를 넘어가면 계획을 접습니다.`
    : `${BAND_META[b.key].label} ${money(b.price)} · ${dist}.`
}

/**
 * 손절 · 익절 가격 띠 (W6, forecast-band).
 *
 * 30일 종가 선 끝(오늘)에서 앞으로 띠를 펴 손절 · 익절 구간을 보인다. 띠에 올리거나 Tab 으로 가면
 * 기준가에서 얼마나 떨어져 있는지 아래에 쓴다. 숫자 표는 이 그림 아래에 그대로 둔다.
 */
export default function RiskBandChart({
  series,
  referencePrice,
  stopLoss,
  takeProfit1,
  takeProfit2,
  stopPct,
  takeProfit1Pct,
  takeProfit2Pct,
  days,
}: RiskBandChartProps) {
  // 0 · 비정상 종가는 축 계산과 같은 기준으로 선에서도 뺀다(선이 축 밖으로 튀지 않게).
  const points = useMemo(() => series.filter((p) => isUsablePrice(p.price)), [series])
  const closes = useMemo(() => points.map((p) => p.price), [points])
  const layout = useMemo(
    () => riskBandLayout({ referencePrice, stopLoss, takeProfit1, takeProfit2 }, closes),
    [referencePrice, stopLoss, takeProfit1, takeProfit2, closes],
  )
  const [active, setActive] = useState<BandKey | null>(null)
  if (!layout) return null

  const n = closes.length
  const fut = Math.min(30, Math.max(3, days ?? 10))
  const span = Math.max(1, n - 1 + fut)
  const X = (i: number) => PAD.l + (i / span) * (W - PAD.l - PAD.r)
  const Y = (v: number) => PAD.t + (1 - (v - layout.lo) / (layout.hi - layout.lo)) * (H - PAD.t - PAD.b)
  const x0 = n > 0 ? X(n - 1) : PAD.l
  const x1 = X(span)
  const line = closes.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  const labelYs = spreadLabels(
    layout.bands.map((b) => Y(b.price)),
    30,
    PAD.t + 4,
    H - PAD.b - 14,
  )
  const activeBand = layout.bands.find((b) => b.key === active) ?? null
  const basis = layout.referenceIsFallback ? '최근 종가' : '기준가'
  const enginePct: Record<BandKey, number | null | undefined> = { stop: stopPct, tp1: takeProfit1Pct, tp2: takeProfit2Pct }
  const pctOf = (b: RiskBand) => {
    const v = enginePct[b.key]
    return !layout.referenceIsFallback && v != null && Number.isFinite(v) ? v : b.diffPct
  }

  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" role="group" aria-label="손절 · 익절 가격 띠">
        <line x1={x0} x2={x0} y1={PAD.t} y2={H - PAD.b} stroke="var(--chart-grid)" strokeDasharray="3 4" />
        {layout.bands.map((b, k) => {
          const meta = BAND_META[b.key]
          const top = Math.min(Y(b.from), Y(b.price))
          const height = Math.abs(Y(b.from) - Y(b.price))
          const dim = active != null && active !== b.key
          return (
            <g
              key={b.key}
              tabIndex={0}
              role="img"
              aria-label={describe(b, basis, pctOf(b))}
              className="risk-band outline-none"
              style={{ opacity: dim ? 0.35 : 1 }}
              onPointerEnter={() => setActive(b.key)}
              onPointerLeave={() => setActive((a) => (a === b.key ? null : a))}
              onFocus={() => setActive(b.key)}
              onBlur={() => setActive((a) => (a === b.key ? null : a))}
            >
              <rect x={x0} y={top} width={x1 - x0} height={Math.max(1, height)} fill={meta.color} fillOpacity={meta.fill} />
              <line x1={x0} x2={x1} y1={Y(b.price)} y2={Y(b.price)} stroke={meta.color} strokeWidth="1.5" />
              <text x={x1 + 8} y={labelYs[k] + 4} fill={meta.color} fontSize="12" fontWeight="600">
                {meta.label} {money(b.price)}
              </text>
              <text x={x1 + 8} y={labelYs[k] + 18} fill="var(--ink-3)" fontSize="11">
                {signed(pctOf(b))}%
              </text>
            </g>
          )
        })}
        {n > 1 && <path d={line} fill="none" stroke="var(--ink-1)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />}
        <line
          x1={x0}
          x2={x1}
          y1={Y(layout.reference)}
          y2={Y(layout.reference)}
          stroke="var(--ink-1)"
          strokeOpacity="0.55"
          strokeDasharray="4 4"
        />
        <circle cx={x0} cy={Y(layout.reference)} r="4" fill="var(--ink-1)" />
        {n >= 2 && (
          <text x={X(0)} y={H - 5} fill="var(--ink-3)" fontSize="11" className="num">
            {points[0].time}
          </text>
        )}
        <text x={x0} y={H - 5} fill="var(--ink-3)" fontSize="11" textAnchor={n === 0 ? 'start' : 'middle'}>
          오늘
        </text>
        <text x={x1} y={H - 5} fill="var(--ink-3)" fontSize="11" textAnchor="end" className="num">
          +{fut}일
        </text>
      </svg>
      <p className="min-h-[20px] text-[12.5px] text-ink-2" aria-hidden="true">
        {activeBand ? describe(activeBand, basis, pctOf(activeBand)) : `띠에 올리면 ${basis}에서 얼마나 떨어져 있는지 보여 줍니다.`}
      </p>
    </div>
  )
}
