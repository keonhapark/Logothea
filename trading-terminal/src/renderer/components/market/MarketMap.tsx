// from https://github.com/Seokwoooo/lucian-uxui-prompt/blob/42396145b375a17712fd738ca0e1d977556c0b73/src/elements/152-treemap-drilldown.html @ 42396145b375a17712fd738ca0e1d977556c0b73 · MIT (c) 2026 Seokwoooo
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sp500Stock } from '../../../lib/types/stockList'
import { changeIntensity, groupBySector, sectorLabel, squarify, topByMarketCap, type Rect } from '../../lib/marketMap'
import { formatChange, formatMarketCap, resolveQuote } from '../../lib/stocksScreen'

interface MarketMapProps {
  list: readonly Sp500Stock[]
  prices: Record<string, { currentPrice: number; previousClose: number } | undefined>
  /** 종목 칸을 누르면 브리핑을 연다. */
  onPick: (ticker: string) => void
}

/** 지도에 올리는 종목 수(시가총액 순). */
export const MAP_TOP_N = 100

const HEIGHT = 560
const HEADER = 20
const GAP = 2
/** 섹터 머리(이름 · 확대 버튼)를 둘 수 있는 최소 크기. 이보다 작은 섹터는 머리 없이 칸만 둔다. */
const HEAD_MIN_W = 48
const HEAD_MIN_H = HEADER + 24

function tileColor(pct: number | null): string {
  const k = changeIntensity(pct)
  if (k == null) return 'rgb(var(--ink-rgb) / 0.07)'
  if (pct === 0) return 'rgb(var(--ink-rgb) / 0.12)'
  const alpha = (0.2 + 0.6 * k).toFixed(3)
  return pct! > 0 ? `rgb(var(--up-rgb) / ${alpha})` : `rgb(var(--down-rgb) / ${alpha})`
}

const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) })

/**
 * 시장 지도 (W1, treemap-drilldown).
 *
 * 시가총액 상위 100 종목을 섹터별로 묶어 면적은 시가총액, 색은 일일 등락률(상승 빨강 · 하락 파랑,
 * ±3% 에서 가장 진함)로 그린다. 섹터 이름을 누르면 그 섹터가 판을 채우고, `전체` 로 돌아온다.
 * 칸은 종목별로 자리를 기억해 확대 · 축소 때 제자리에서 커지고 줄어든다.
 */
export default function MarketMap({ list, prices, onPick }: MarketMapProps) {
  // 판 폭을 잰다. 지도가 늦게 그려져도 붙는 순간 재도록 callback ref 를 쓴다.
  // 크기를 바꾸는 동안에는 칸 이동 애니메이션을 꺼 칸이 늦게 따라오지 않게 한다.
  const [width, setWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const roRef = useRef<ResizeObserver | null>(null)
  const resizeTimer = useRef(0)
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    setWidth(el.clientWidth)
    let first = true
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      if (first) {
        first = false
        return
      }
      setResizing(true)
      window.clearTimeout(resizeTimer.current)
      resizeTimer.current = window.setTimeout(() => setResizing(false), 180)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])
  useEffect(() => () => window.clearTimeout(resizeTimer.current), [])

  const [zoomState, setZoom] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const top = useMemo(() => topByMarketCap(list, MAP_TOP_N), [list])
  const groups = useMemo(() => groupBySector(top), [top])
  // 목록이 바뀌어 확대한 섹터가 없어지면 전체로 돌아간다.
  const zoom = zoomState != null && groups.some((g) => g.sector === zoomState) ? zoomState : null
  const quotes = useMemo(() => {
    const m = new Map<string, { price: number | null; changePct: number | null }>()
    for (const s of top) m.set(s.ticker, resolveQuote(s, prices[s.ticker]))
    return m
  }, [top, prices])

  // 섹터마다 머리(있으면)와 그 섹터의 칸. 확대 중이면 그 섹터의 종목이 판 전체를 나눠 갖고, 다른 섹터는 자리에서 사라진다.
  const sectors = useMemo(() => {
    const full: Rect = { x: 0, y: 0, w: width, h: HEIGHT }
    return squarify(groups.map((g) => ({ value: g.value, item: g })), full).map((s) => {
      const g = s.item
      const zoomed = zoom === g.sector
      const visible = zoom == null || zoomed
      const hasHead = zoom == null && s.w >= HEAD_MIN_W && s.h >= HEAD_MIN_H
      const area = zoomed ? full : hasHead ? { x: s.x, y: s.y + HEADER, w: s.w, h: s.h - HEADER } : { x: s.x, y: s.y, w: s.w, h: s.h }
      const cells = squarify(g.stocks.map((st) => ({ value: st.marketCapUsd ?? 0, item: st })), area)
      return {
        sector: g.sector,
        count: g.stocks.length,
        head: hasHead ? { x: s.x, y: s.y, w: s.w } : null,
        visible,
        tiles: cells.map((c) => ({ stock: c.item, rect: inset(c, GAP / 2) })),
      }
    })
  }, [groups, width, zoom])

  // 확대 · 복귀로 누른 버튼이 사라진다. 확대하면 `전체` 로, 돌아오면 방금 연 섹터의 머리로 포커스를 옮긴다.
  const rootRef = useRef<HTMLDivElement>(null)
  const lastZoom = useRef<string | null>(null)
  const focusAfterZoom = useRef(false)
  const changeZoom = (next: string | null) => {
    focusAfterZoom.current = true
    if (next != null) lastZoom.current = next
    setZoom(next)
  }
  useEffect(() => {
    if (!focusAfterZoom.current) return
    focusAfterZoom.current = false
    const root = rootRef.current
    if (!root) return
    const target =
      zoom != null
        ? root.querySelector<HTMLElement>('[data-map-back]')
        : root.querySelector<HTMLElement>(`[data-map-sector="${CSS.escape(lastZoom.current ?? '')}"]`)
    target?.focus({ preventScroll: true })
  }, [zoom])

  const hovered = hover ? top.find((s) => s.ticker === hover) ?? null : null
  const hq = hovered ? quotes.get(hovered.ticker) : undefined

  if (top.length === 0) {
    return <p className="py-12 text-center text-[13px] text-ink-3">시가총액 정보가 있는 종목이 없어 지도를 그릴 수 없습니다.</p>
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2 min-h-[28px] text-[13px]" aria-live="polite">
        {zoom ? (
          <>
            <button type="button" className="gbtn gbtn-sm" onClick={() => changeZoom(null)} data-map-back>
              전체
            </button>
            <span className="text-ink-3">/</span>
            <span className="font-semibold text-ink-1">{sectorLabel(zoom)}</span>
          </>
        ) : (
          <span className="text-ink-3">
            시가총액 상위 <span className="tabular-nums">{top.length}</span>종목 · 면적은 시가총액, 색은 일일 등락률 · 섹터 이름을 누르면 그 섹터만 봅니다
          </span>
        )}
      </div>

      <div
        ref={boxRef}
        className={`relative w-full rounded-[16px] overflow-hidden ${resizing ? 'map-resizing' : ''}`}
        style={{ height: HEIGHT }}
        onPointerLeave={() => setHover(null)}
      >
        {/* Tab 순서가 화면과 맞도록 섹터마다 머리 다음에 그 섹터의 칸을 둔다 */}
        {width > 0 &&
          sectors.map((sec) => (
            <div key={sec.sector} role="group" aria-label={`${sectorLabel(sec.sector)} ${sec.count}종목`}>
              {sec.head && (
                <button
                  type="button"
                  data-map-sector={sec.sector}
                  onClick={() => changeZoom(sec.sector)}
                  className="absolute px-1.5 text-left text-[11px] font-semibold text-ink-2 hover:text-ink-1 truncate"
                  style={{ left: sec.head.x, top: sec.head.y, width: sec.head.w, height: HEADER, lineHeight: `${HEADER}px` }}
                  aria-label={`${sectorLabel(sec.sector)} 섹터 ${sec.count}종목만 보기`}
                >
                  {sectorLabel(sec.sector)}
                </button>
              )}
              {sec.tiles.map(({ stock, rect }) => (
                <MapTile
                  key={stock.ticker}
                  stock={stock}
                  rect={rect}
                  pct={quotes.get(stock.ticker)?.changePct ?? null}
                  visible={sec.visible}
                  onPick={onPick}
                  onHover={setHover}
                />
              ))}
            </div>
          ))}
      </div>

      <p className="min-h-[20px] text-[12.5px] text-ink-2" aria-hidden="true">
        {hovered && hq ? (
          <>
            <span className="num font-semibold text-ink-1">{hovered.ticker}</span> {hovered.companyName} · {sectorLabel(hovered.sector?.trim() || '기타')} · 시가총액{' '}
            {formatMarketCap(hovered.marketCapUsd)} · 일일 {hq.changePct == null ? '정보 없음' : formatChange(hq.changePct).text}
          </>
        ) : (
          '칸에 올리면 종목 정보를, 누르면 브리핑을 엽니다.'
        )}
      </p>
    </div>
  )
}

/** 종목 칸 하나. 마우스를 옮길 때마다 100칸이 다시 그려지지 않도록 값이 같으면 건너뛴다. */
const MapTile = memo(function MapTile({
  stock,
  rect,
  pct,
  visible,
  onPick,
  onHover,
}: {
  stock: Sp500Stock
  rect: Rect
  pct: number | null
  visible: boolean
  onPick: (ticker: string) => void
  onHover: (ticker: string) => void
}) {
  const ch = formatChange(pct)
  const showText = rect.w >= 42 && rect.h >= 26
  const showPct = rect.w >= 54 && rect.h >= 42
  return (
    <button
      type="button"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() => onPick(stock.ticker)}
      onPointerEnter={() => onHover(stock.ticker)}
      onFocus={() => onHover(stock.ticker)}
      className="map-tile absolute rounded-[6px] overflow-hidden text-left px-1.5 py-1 flex flex-col"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        background: tileColor(pct),
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? undefined : 'none',
      }}
      aria-label={`${stock.ticker} ${stock.companyName}, 시가총액 ${formatMarketCap(stock.marketCapUsd)}, 일일 ${pct == null ? '정보 없음' : ch.text}. 브리핑 열기`}
    >
      {showText && (
        <>
          <span className="num text-[12px] font-semibold text-ink-1 leading-tight truncate">{stock.ticker}</span>
          {showPct && <span className="num text-[11px] text-ink-1/80 leading-tight truncate">{ch.text}</span>}
        </>
      )}
    </button>
  )
}, (a, b) =>
  a.stock === b.stock &&
  a.pct === b.pct &&
  a.visible === b.visible &&
  a.onPick === b.onPick &&
  a.onHover === b.onHover &&
  a.rect.x === b.rect.x &&
  a.rect.y === b.rect.y &&
  a.rect.w === b.rect.w &&
  a.rect.h === b.rect.h,
)
