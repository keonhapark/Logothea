import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStockMarketStore } from '@terminal/renderer/store/useStockMarketStore'
import { usePricesStore } from '@terminal/renderer/store/usePricesStore'
import { changeIntensity, groupBySector, sectorLabel, squarify, topByMarketCap, type Rect } from '@terminal/renderer/lib/marketMap'
import { filterStocks, formatChange, formatMarketCap, formatPrice, resolveQuote } from '@terminal/renderer/lib/stocksScreen'
import type { IpcErrorCode } from '@terminal/lib/types/ipcError'
import type { Sp500Stock } from '@terminal/lib/types/stockList'
import { openBrief } from './Brief'

/**
 * 시장. 제목 옆 `표 / 지도` 전환(처음은 지도, 기억하지 않음).
 * 지도는 데스크톱 MarketMap(components/market/MarketMap.tsx), 표는 StockMarketTable 을 모바일로 다시 만들었다.
 * 배치 · 필터 계산은 터미널 lib(marketMap · stocksScreen)를 그대로 쓴다.
 */
export default function Market() {
  const [view, setView] = useState<'map' | 'table'>('map')
  const list = useStockMarketStore((s) => s.list)
  const isLoaded = useStockMarketStore((s) => s.isLoaded)
  const error = useStockMarketStore((s) => s.error)
  const loadList = useStockMarketStore((s) => s.loadList)
  const invalidate = useStockMarketStore((s) => s.invalidate)
  useEffect(() => {
    void loadList()
  }, [loadList])

  const retry = () => {
    invalidate()
    void loadList()
  }

  return (
    <main className="screen">
      <h1 className="large-title" tabIndex={-1}>
        시장
        <span className="seg dent" role="tablist" aria-label="보기">
          {(['table', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              aria-controls="market-panel"
              onClick={() => setView(v)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  const next = v === 'map' ? 'table' : 'map'
                  setView(next)
                  ;(e.currentTarget.parentElement?.querySelector(`[data-view="${next}"]`) as HTMLElement | null)?.focus()
                }
              }}
              data-view={v}
              tabIndex={view === v ? 0 : -1}
            >
              {v === 'map' ? '지도' : '표'}
            </button>
          ))}
        </span>
      </h1>
      <div id="market-panel" role="tabpanel" aria-label={view === 'map' ? '시장 지도' : '종목 표'}>
        {!isLoaded ? (
          <LoadingRows />
        ) : error && list.length === 0 ? (
          <ListError code={error} onRetry={retry} />
        ) : view === 'map' ? (
          <MarketMap list={list} />
        ) : (
          <StockTable list={list} />
        )}
      </div>
    </main>
  )
}

function LoadingRows() {
  return (
    <div className="cloud panel" aria-busy="true">
      <div className="stack-10">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skeleton" />
        ))}
      </div>
    </div>
  )
}

/** 실패 사유 표(데스크톱 stocks.md). 로그인 만료는 다시 시도해도 같은 실패라 버튼을 두지 않는다. */
const FAILURE_REASON: Partial<Record<IpcErrorCode, string>> = {
  NETWORK: '서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.',
  BACKEND_5XX: '서버가 응답하지 않습니다.',
  AUTH_EXPIRED: '접속이 만료되었습니다. 페이지를 새로 고쳐 주세요.',
  AUTH_REQUIRED: '접속이 만료되었습니다. 페이지를 새로 고쳐 주세요.',
}

function ListError({ code, onRetry }: { code: IpcErrorCode; onRetry: () => void }) {
  const auth = code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED'
  return (
    <div className="cloud panel state">
      <p>종목 목록을 불러오지 못했습니다.</p>
      <p className="fine">{FAILURE_REASON[code] ?? '잠시 뒤 다시 시도해 주세요.'}</p>
      {!auth && (
        <button type="button" className="glass pill" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

// ── 지도 ─────────────────────────────────────────────────────────────────

export const MAP_TOP_N = 100
/** 섹터 머리 높이. 확대하는 유일한 수단이라 누르기 쉽게 데스크톱(20px)보다 높게 둔다. */
const HEADER = 26
const GAP = 3
const HEAD_MIN_W = 56
const HEAD_MIN_H = HEADER + 28

/** 데스크톱 MarketMap.tsx 의 tileColor 와 같은 식(그 파일 안의 비공개 함수라 옮겨 둠). ±3% 에서 가장 진하다. */
export function tileColor(pct: number | null): string {
  const k = changeIntensity(pct)
  if (k == null) return 'rgb(var(--ink-rgb) / 0.07)'
  if (pct === 0) return 'rgb(var(--ink-rgb) / 0.12)'
  const alpha = (0.2 + 0.6 * k).toFixed(3)
  return pct! > 0 ? `rgb(var(--up-rgb) / ${alpha})` : `rgb(var(--down-rgb) / ${alpha})`
}

const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) })

function MarketMap({ list }: { list: readonly Sp500Stock[] }) {
  const prices = usePricesStore((s) => s.prices)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const roRef = useRef<ResizeObserver | null>(null)
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  const [zoomState, setZoom] = useState<string | null>(null)
  const top = useMemo(() => topByMarketCap(list, MAP_TOP_N), [list])
  const groups = useMemo(() => groupBySector(top), [top])
  const zoom = zoomState != null && groups.some((g) => g.sector === zoomState) ? zoomState : null
  const quotes = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const s of top) m.set(s.ticker, resolveQuote(s, prices[s.ticker]).changePct)
    return m
  }, [top, prices])

  const sectors = useMemo(() => {
    const full: Rect = { x: 0, y: 0, w: size.w, h: size.h }
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
  }, [groups, size, zoom])

  // 확대 · 복귀로 누른 버튼이 사라진다. 확대하면 `전체` 로, 돌아오면 방금 연 섹터 머리로 포커스를 옮긴다.
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
    const target =
      zoom != null
        ? root?.querySelector<HTMLElement>('[data-map-back]')
        : root?.querySelector<HTMLElement>(`[data-map-sector="${CSS.escape(lastZoom.current ?? '')}"]`)
    target?.focus({ preventScroll: true })
  }, [zoom])

  if (top.length === 0) {
    return <p className="cloud panel state">시가총액 정보가 있는 종목이 없어 지도를 그릴 수 없습니다.</p>
  }

  return (
    <div ref={rootRef} className="map-wrap">
      <div className="map-bar" aria-live="polite">
        {zoom ? (
          <>
            <button type="button" className="glass pill" onClick={() => changeZoom(null)} data-map-back>
              전체
            </button>
            <span className="fine">/</span>
            <b>{sectorLabel(zoom)}</b>
          </>
        ) : null}
      </div>
      <div className="map cloud">
        <div ref={boxRef} className="map-box">
          {size.w > 0 &&
            size.h > 0 &&
            sectors.map((sec) => (
              <div key={sec.sector} role="group" aria-label={`${sectorLabel(sec.sector)} ${sec.count}종목`}>
                {sec.head && (
                  <button
                    type="button"
                    data-map-sector={sec.sector}
                    onClick={() => changeZoom(sec.sector)}
                    className="map-head"
                    style={{ left: sec.head.x, top: sec.head.y, width: sec.head.w, height: HEADER }}
                    aria-label={`${sectorLabel(sec.sector)} 섹터 ${sec.count}종목만 보기`}
                  >
                    {sectorLabel(sec.sector)}
                  </button>
                )}
                {sec.tiles.map(({ stock, rect }) => (
                  <MapTile key={stock.ticker} stock={stock} rect={rect} pct={quotes.get(stock.ticker) ?? null} visible={sec.visible} />
                ))}
              </div>
            ))}
        </div>
      </div>
      <p className="fine map-note">시가총액 상위 {top.length}종목 · 섹터를 누르면 확대, 종목을 누르면 브리핑</p>
    </div>
  )
}

const MapTile = memo(function MapTile({ stock, rect, pct, visible }: { stock: Sp500Stock; rect: Rect; pct: number | null; visible: boolean }) {
  const ch = formatChange(pct)
  const showText = rect.w >= 34 && rect.h >= 22
  const showPct = rect.w >= 50 && rect.h >= 38
  return (
    <button
      type="button"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() => openBrief(stock.ticker)}
      className="map-tile"
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
          <span className="tnum map-tk">{stock.ticker}</span>
          {showPct && <span className="tnum map-pct">{ch.text.replace(/^[▲▼] /, '')}</span>}
        </>
      )}
    </button>
  )
})

// ── 표 ───────────────────────────────────────────────────────────────────

const CHUNK = 50

function StockTable({ list }: { list: readonly Sp500Stock[] }) {
  const prices = usePricesStore((s) => s.prices)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(CHUNK)
  const rows = useMemo(() => filterStocks(list, 'all', query, { watch: new Set(), held: new Set(), week: new Map() }), [list, query])
  useEffect(() => setCount(CHUNK), [query])

  // 스크롤로 이어 붙인다(페이지 버튼 없음)
  const sentinel = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((n) => n + CHUNK)
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [rows.length, count])

  return (
    <div className="stack-10">
      <label className="search dent">
        <span className="sr-only">종목 검색</span>
        <input
          type="search"
          value={query}
          placeholder="티커 · 회사명 검색"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {rows.length === 0 ? (
        <div className="cloud panel state">
          <p>{query.trim() ? `"${query.trim()}" 검색 결과가 없습니다.` : '종목 목록이 비어 있습니다.'}</p>
          {query && (
            <button type="button" className="glass pill" onClick={() => setQuery('')}>
              검색어 지우기
            </button>
          )}
        </div>
      ) : (
        <ul className="cloud panel rows stock-rows" aria-label={`종목 ${rows.length}개`}>
          {rows.slice(0, count).map((s) => {
            const q = resolveQuote(s, prices[s.ticker])
            const ch = formatChange(q.changePct)
            return (
              <li key={s.ticker}>
                <button type="button" className="row-btn stock-r" onClick={() => openBrief(s.ticker)}>
                  <span className="stock-id">
                    <b className="tnum">{s.ticker}</b>
                    <span>{s.companyName}</span>
                  </span>
                  <span className="stock-q">
                    <span className="tnum">{formatPrice(q.price)}</span>
                    <span className={`tnum ${ch.dir === 'up' ? 'up' : ch.dir === 'down' ? 'down' : ''}`}>{ch.text.replace(/^[▲▼] /, '')}</span>
                  </span>
                  <span className="sr-only">종목 브리핑 열기</span>
                </button>
              </li>
            )
          })}
          {count < rows.length && <li ref={sentinel} aria-hidden="true" className="sentinel" />}
        </ul>
      )}
    </div>
  )
}
