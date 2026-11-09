/**
 * 포트폴리오 비중 도넛(W5)의 조각 계산 — 렌더링과 떼어 테스트하는 순수 함수.
 *
 * 총자산 = 보유 평가금액 합 + 현금. 조각은 평가금액이 큰 순서이고, 색을 줄 수 있는 개수를 넘는
 * 종목은 `기타` 한 조각으로 묶는다. 현금은 늘 마지막 조각이다(0 이면 두지 않는다).
 */

export interface DonutInput {
  ticker: string
  name: string
  marketValue: number
}

export interface DonutSlice {
  /** 종목 티커, `기타` 는 'OTHER', 현금은 'CASH'. */
  key: string
  label: string
  value: number
  /** 총자산 대비 비중 0~1. */
  weight: number
  kind: 'stock' | 'other' | 'cash'
  /** `기타` 에 묶인 종목 수. */
  count?: number
}

/** 색을 따로 주는 종목 수. 그 밖은 `기타` 로 묶는다. */
export const DONUT_COLORED = 5

export function donutSlices(holdings: readonly DonutInput[], cash: number, colored = DONUT_COLORED): DonutSlice[] {
  const valid = holdings.filter((h) => Number.isFinite(h.marketValue) && h.marketValue > 0)
  const cashValue = Number.isFinite(cash) && cash > 0 ? cash : 0
  const total = valid.reduce((s, h) => s + h.marketValue, 0) + cashValue
  if (!(total > 0)) return []

  const sorted = [...valid].sort((a, b) => b.marketValue - a.marketValue)
  // 묶을 종목이 하나뿐이면 `기타` 로 감추지 않고 그대로 보인다.
  const keep = sorted.length > colored + 1 ? sorted.slice(0, colored) : sorted
  const rest = sorted.slice(keep.length)

  const slices: DonutSlice[] = keep.map((h) => ({
    key: h.ticker,
    label: h.name,
    value: h.marketValue,
    weight: h.marketValue / total,
    kind: 'stock',
  }))
  if (rest.length > 0) {
    const value = rest.reduce((s, h) => s + h.marketValue, 0)
    slices.push({ key: 'OTHER', label: `기타 ${rest.length}종목`, value, weight: value / total, kind: 'other', count: rest.length })
  }
  if (cashValue > 0) slices.push({ key: 'CASH', label: '현금', value: cashValue, weight: cashValue / total, kind: 'cash' })
  return slices
}
