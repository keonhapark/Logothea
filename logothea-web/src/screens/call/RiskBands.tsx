import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { PricePoint } from '@terminal/renderer/types/priceSeries'
import { isUsablePrice, riskBandLayout, spreadLabels, type BandKey, type RiskBand } from '@terminal/renderer/lib/riskBand'

/**
 * 손절 · 익절 가격 띠 — 모바일판.
 * 원본: trading-terminal/src/renderer/components/call/RiskBandChart.tsx (배치 계산 lib/riskBand.ts 는 그대로 쓴다).
 *
 * 데스크톱판은 640 폭 그림이라 휴대폰 폭으로 줄이면 글자가 6px 남짓이 된다. 여기서는 그림 폭을 실제로 그려지는 폭에
 * 맞춰(1 단위 = 1px) 라벨이 늘 12px 로 보이게 하고, 오른쪽 라벨 칸을 줄여 이름과 가격 · 비율을 두 줄로 쓴다.
 * 마우스 올리기가 없으므로 띠(또는 그 라벨)를 누르면 고르고, 고른 띠의 설명을 아래에 쓴다. 다시 누르면 거둔다.
 */

interface RiskBandsProps {
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

/** 폭을 재기 전 기본값. 390 폭 휴대폰의 판단 판 안쪽 폭과 비슷하다. */
const DEFAULT_W = 306
const H = 210
const PAD = { l: 4, r: 98, t: 14, b: 24 }
/** 라벨 두 줄(12px)이 겹치지 않는 간격. */
const LABEL_GAP = 32

const BAND_META: Record<BandKey, { label: string; color: string; fill: number }> = {
  stop: { label: '손절', color: 'var(--porphyra-ink)', fill: 0.16 },
  tp1: { label: '1차 익절', color: 'var(--olive-ink)', fill: 0.16 },
  tp2: { label: '2차 익절', color: 'var(--olive-ink)', fill: 0.09 },
}

const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

/** 고른 띠 설명(데스크톱과 같은 문구). */
export function describeBand(b: Pick<RiskBand, 'key' | 'price' | 'diff'>, basis: string, pct: number): string {
  const dist = `${basis}보다 ${money(Math.abs(b.diff))}(${signed(pct)}%) ${b.diff < 0 ? '아래' : '위'}`
  return b.key === 'stop'
    ? `${BAND_META.stop.label} ${money(b.price)} · ${dist}. 종가가 여기를 넘어가면 계획을 접습니다.`
    : `${BAND_META[b.key].label} ${money(b.price)} · ${dist}.`
}

export default function RiskBands({
  series,
  referencePrice,
  stopLoss,
  takeProfit1,
  takeProfit2,
  stopPct,
  takeProfit1Pct,
  takeProfit2Pct,
  days,
}: RiskBandsProps) {
  // 0 · 비정상 종가는 축 계산과 같은 기준으로 선에서도 뺀다
  const points = useMemo(() => series.filter((p) => isUsablePrice(p.price)), [series])
  const closes = useMemo(() => points.map((p) => p.price), [points])
  const layout = useMemo(
    () => riskBandLayout({ referencePrice, stopLoss, takeProfit1, takeProfit2 }, closes),
    [referencePrice, stopLoss, takeProfit1, takeProfit2, closes],
  )
  const [active, setActive] = useState<BandKey | null>(null)
  const [W, setW] = useState(DEFAULT_W)
  const roRef = useRef<ResizeObserver | null>(null)
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const measure = () => {
      const w = Math.round(el.clientWidth)
      if (w > 0) setW(w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])
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
    LABEL_GAP,
    PAD.t + 4,
    H - PAD.b - 18,
  )
  const activeBand = layout.bands.find((b) => b.key === active) ?? null
  const basis = layout.referenceIsFallback ? '최근 종가' : '기준가'
  const enginePct: Record<BandKey, number | null | undefined> = { stop: stopPct, tp1: takeProfit1Pct, tp2: takeProfit2Pct }
  const pctOf = (b: RiskBand) => {
    const v = enginePct[b.key]
    return !layout.referenceIsFallback && v != null && Number.isFinite(v) ? v : b.diffPct
  }
  const toggle = (key: BandKey) => setActive((a) => (a === key ? null : key))
  const onKey = (e: KeyboardEvent, key: BandKey) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle(key)
    }
  }

  return (
    <div className="risk" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="risk-svg" role="group" aria-label="손절 · 익절 가격 띠">
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
              role="button"
              aria-pressed={active === b.key}
              aria-label={describeBand(b, basis, pctOf(b))}
              className="risk-band"
              style={{ opacity: dim ? 0.35 : 1 }}
              onClick={() => toggle(b.key)}
              onKeyDown={(e) => onKey(e, b.key)}
            >
              <rect x={x0} y={top} width={x1 - x0} height={Math.max(1, height)} fill={meta.color} fillOpacity={meta.fill} />
              {/* 얇은 띠도 누르기 쉽게 투명한 자리를 위아래로 넓힌다 */}
              <rect x={x0} y={Math.min(top, Y(b.price) - 10)} width={W - x0} height={Math.max(height, 20)} fill="transparent" />
              <line x1={x0} x2={x1} y1={Y(b.price)} y2={Y(b.price)} stroke={meta.color} strokeWidth={active === b.key ? 2.5 : 1.5} />
              <text x={x1 + 6} y={labelYs[k] + 4} fill={meta.color} fontSize="12" fontWeight="650">
                {meta.label}
              </text>
              <text x={x1 + 6} y={labelYs[k] + 19} fill="var(--ink-2)" fontSize="12" className="tnum">
                {money(b.price)} {signed(pctOf(b))}%
              </text>
            </g>
          )
        })}
        {n > 1 && <path d={line} fill="none" stroke="var(--ink-1)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />}
        <line
          x1={x0}
          x2={x1}
          y1={Y(layout.reference)}
          y2={Y(layout.reference)}
          stroke="var(--ink-1)"
          strokeOpacity="0.55"
          strokeDasharray="4 4"
          pointerEvents="none"
        />
        <circle cx={x0} cy={Y(layout.reference)} r="4" fill="var(--ink-1)" pointerEvents="none" />
        {n >= 2 && (
          <text x={X(0)} y={H - 6} fill="var(--ink-3)" fontSize="12" className="num">
            {points[0].time}
          </text>
        )}
        <text x={x0} y={H - 6} fill="var(--ink-3)" fontSize="12" textAnchor={n === 0 ? 'start' : 'middle'}>
          오늘
        </text>
        <text x={x1} y={H - 6} fill="var(--ink-3)" fontSize="12" textAnchor="end" className="num">
          +{fut}일
        </text>
      </svg>
      <p className="risk-note" aria-live="polite">
        {activeBand ? describeBand(activeBand, basis, pctOf(activeBand)) : `띠를 누르면 ${basis}에서 얼마나 떨어져 있는지 보여 줍니다.`}
      </p>
    </div>
  )
}
