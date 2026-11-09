/**
 * 시장 지도(W1)의 계산 — 렌더링과 떼어 테스트하는 순수 함수.
 *
 *  - 시가총액 상위 N 종목을 고른다. 서버 순위(marketCapRank)가 있으면 그것을, 없으면 시가총액 순으로.
 *  - 섹터별로 묶는다. 섹터 · 종목 모두 면적은 시가총액이다.
 *  - 직사각형을 정사각형에 가깝게 나눈다(squarified treemap, Bruls · Huizing · van Wijk 2000).
 */
import type { Sp500Stock } from '../../lib/types/stockList'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tile<T> extends Rect {
  item: T
}

export interface SectorGroup {
  sector: string
  value: number
  stocks: Sp500Stock[]
}

const capOf = (s: Sp500Stock) => (s.marketCapUsd != null && Number.isFinite(s.marketCapUsd) ? s.marketCapUsd : 0)

/** 시가총액 상위 N. 시가총액이 없거나 0 이하인 종목은 면적을 줄 수 없어 뺀다. */
export function topByMarketCap(list: readonly Sp500Stock[], n: number): Sp500Stock[] {
  const valid = list.filter((s) => capOf(s) > 0)
  const ranked = valid.filter((s) => s.marketCapRank != null)
  if (ranked.length > 0) {
    return ranked
      .filter((s) => (s.marketCapRank as number) <= n)
      .sort((a, b) => (a.marketCapRank as number) - (b.marketCapRank as number))
  }
  return [...valid].sort((a, b) => capOf(b) - capOf(a)).slice(0, n)
}

/** 섹터별로 묶는다. 섹터 · 섹터 안 종목 모두 시가총액이 큰 순서. 섹터가 없으면 `기타`. */
export function groupBySector(stocks: readonly Sp500Stock[]): SectorGroup[] {
  const map = new Map<string, SectorGroup>()
  for (const s of stocks) {
    const sector = s.sector?.trim() || '기타'
    const g = map.get(sector) ?? { sector, value: 0, stocks: [] }
    g.value += capOf(s)
    g.stocks.push(s)
    map.set(sector, g)
  }
  const groups = [...map.values()]
  for (const g of groups) g.stocks.sort((a, b) => capOf(b) - capOf(a))
  return groups.sort((a, b) => b.value - a.value)
}

/** 한 줄에 놓인 조각들 중 가장 길쭉한 것의 가로세로비(1 이상). 작을수록 정사각형에 가깝다. */
function worst(areas: readonly number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0)
  if (sum <= 0 || side <= 0) return Infinity
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const s2 = side * side
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min))
}

/**
 * 값에 비례하는 면적으로 rect 를 나눈다. 값이 0 이하인 항목은 빼고, 입력 순서(큰 것부터 주는 것을 권함)를
 * 따라 짧은 변을 따라 줄을 쌓는다. 결과 면적의 합은 rect 면적과 같다.
 */
export function squarify<T>(items: readonly { value: number; item: T }[], rect: Rect): Tile<T>[] {
  const list = items.filter((i) => Number.isFinite(i.value) && i.value > 0)
  const total = list.reduce((s, i) => s + i.value, 0)
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const queue = list.map((i) => ({ item: i.item, area: i.value * scale }))
  const out: Tile<T>[] = []
  let { x, y, w, h } = rect

  let row: typeof queue = []
  const layoutRow = () => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    if (w >= h) {
      // 세로로 한 열을 세운다
      const colW = sum / h
      let cy = y
      for (const r of row) {
        const rh = r.area / colW
        out.push({ item: r.item, x, y: cy, w: colW, h: rh })
        cy += rh
      }
      x += colW
      w -= colW
    } else {
      const rowH = sum / w
      let cx = x
      for (const r of row) {
        const rw = r.area / rowH
        out.push({ item: r.item, x: cx, y, w: rw, h: rowH })
        cx += rw
      }
      y += rowH
      h -= rowH
    }
    row = []
  }

  for (const next of queue) {
    const side = Math.min(w, h)
    const current = row.map((r) => r.area)
    if (row.length === 0 || worst([...current, next.area], side) <= worst(current, side)) {
      row.push(next)
    } else {
      layoutRow()
      row.push(next)
    }
  }
  if (row.length > 0) layoutRow()
  return out
}

/**
 * 등락률 → 칸 색의 세기(0~1). ±3% 에서 가득 찬다. 모르면 null(회색 칸).
 * 방향 색은 앱 규칙(상승 빨강 · 하락 파랑)을 호출 측이 입힌다.
 */
export function changeIntensity(pct: number | null): number | null {
  if (pct == null || !Number.isFinite(pct)) return null
  return Math.min(1, Math.abs(pct) / 3)
}

/** GICS 11 섹터의 한국어 이름. 목록에 없으면 원래 이름을 그대로 쓴다. */
const SECTOR_KO: Record<string, string> = {
  'Information Technology': '정보기술',
  Financials: '금융',
  'Health Care': '헬스케어',
  Industrials: '산업재',
  'Consumer Discretionary': '경기소비재',
  'Consumer Staples': '필수소비재',
  'Communication Services': '커뮤니케이션',
  Utilities: '유틸리티',
  'Real Estate': '부동산',
  Materials: '소재',
  Energy: '에너지',
}

export function sectorLabel(sector: string): string {
  return SECTOR_KO[sector] ?? sector
}
