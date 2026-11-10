/**
 * 손절 · 익절 가격 띠(W6)의 계산 — 렌더링과 떼어 테스트하는 순수 함수.
 *
 * 기준가에서 손절가까지, 기준가에서 1차 익절까지, 1차에서 2차 익절까지를 각각 한 띠로 본다.
 * 값이 없는 단계는 띠를 만들지 않는다(0 으로 채우면 없는 계획이 있는 것처럼 보인다).
 */
import type { RiskPlan } from '../types/earningsSummary'

export type BandKey = 'stop' | 'tp1' | 'tp2'

export interface RiskBand {
  key: BandKey
  /** 띠의 끝(손절가 · 익절가). */
  price: number
  /** 띠가 시작하는 가격(기준가, 2차는 1차 익절가). */
  from: number
  /** 기준가 대비 거리. */
  diff: number
  diffPct: number
}

export interface RiskBandLayout {
  reference: number
  /** 엔진이 기준가를 주지 않아 마지막 종가를 대신 썼으면 true. 문구를 "최근 종가" 로 바꾼다. */
  referenceIsFallback: boolean
  bands: RiskBand[]
  /** 세로축 범위. 가격선과 띠가 모두 들어가고 위아래로 여유를 둔다. */
  lo: number
  hi: number
}

/** 쓸 수 있는 가격 — 유한하고 0 보다 크다. 가격선도 같은 기준으로 거른다. */
export const isUsablePrice = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0

export function riskBandLayout(
  plan: Pick<RiskPlan, 'referencePrice' | 'stopLoss' | 'takeProfit1' | 'takeProfit2'>,
  closes: readonly number[],
): RiskBandLayout | null {
  const prices = closes.filter(isUsablePrice)
  const reference = isUsablePrice(plan.referencePrice) ? plan.referencePrice : prices.length > 0 ? prices[prices.length - 1] : null
  if (reference == null) return null

  const band = (key: BandKey, price: number | null, from: number): RiskBand | null =>
    isUsablePrice(price) ? { key, price, from, diff: price - reference, diffPct: ((price - reference) / reference) * 100 } : null
  const tp1 = band('tp1', plan.takeProfit1, reference)
  const bands = [
    band('stop', plan.stopLoss, reference),
    tp1,
    band('tp2', plan.takeProfit2, tp1 ? tp1.price : reference),
  ].filter((b): b is RiskBand => b !== null)
  if (bands.length === 0) return null

  const all = [...prices, reference, ...bands.map((b) => b.price)]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min || reference * 0.02) * 0.08
  return { reference, referenceIsFallback: !isUsablePrice(plan.referencePrice), bands, lo: min - pad, hi: max + pad }
}

/**
 * 오른쪽 이름표가 겹치지 않게 세로 위치를 민다. 위에서부터 차례로 두고, 앞 이름표와 gap 보다
 * 가까우면 아래로 내린다. 넘친 만큼은 다시 위로 올려 아래 경계(maxY)를 넘지 않게 한다.
 */
export function spreadLabels(ys: readonly number[], gap: number, minY: number, maxY: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  const placed = order.map((o) => o.y)
  for (let k = 0; k < placed.length; k++) {
    placed[k] = Math.max(placed[k], minY, k > 0 ? placed[k - 1] + gap : -Infinity)
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    placed[k] = Math.min(placed[k], maxY, k < placed.length - 1 ? placed[k + 1] - gap : Infinity)
  }
  const out = new Array<number>(ys.length)
  order.forEach((o, k) => (out[o.i] = placed[k]))
  return out
}
