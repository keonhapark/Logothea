import { describe, it, expect } from 'vitest'
import { riskBandLayout, spreadLabels } from '../riskBand'

const plan = (o: Partial<{ referencePrice: number | null; stopLoss: number | null; takeProfit1: number | null; takeProfit2: number | null }> = {}) => ({
  referencePrice: 100,
  stopLoss: 95,
  takeProfit1: 104,
  takeProfit2: 108,
  ...o,
})

describe('riskBandLayout', () => {
  it('손절 · 1차 · 2차 띠를 기준가에서 잰다. 2차는 1차 익절가에서 시작한다', () => {
    const l = riskBandLayout(plan(), [98, 99, 100])!
    expect(l.reference).toBe(100)
    expect(l.referenceIsFallback).toBe(false)
    expect(l.bands.map((b) => [b.key, b.from, b.price])).toEqual([
      ['stop', 100, 95],
      ['tp1', 100, 104],
      ['tp2', 104, 108],
    ])
    expect(l.bands[0].diff).toBe(-5)
    expect(l.bands[0].diffPct).toBeCloseTo(-5)
  })

  it('세로축은 가격선과 띠를 모두 담고 위아래로 여유를 둔다', () => {
    const l = riskBandLayout(plan(), [90, 101])!
    expect(l.lo).toBeLessThan(90)
    expect(l.hi).toBeGreaterThan(108)
  })

  it('기준가가 없으면 마지막 종가를 기준으로 쓴다', () => {
    const l = riskBandLayout(plan({ referencePrice: null }), [97, 98.5, 0])!
    expect(l.reference).toBe(98.5)
    expect(l.referenceIsFallback).toBe(true)
  })

  it('기준가도 종가도 없으면 그리지 않는다', () => {
    expect(riskBandLayout(plan({ referencePrice: null }), [])).toBeNull()
  })

  it('값이 없는 단계는 띠를 만들지 않고, 1차가 없으면 2차는 기준가에서 시작한다', () => {
    const l = riskBandLayout(plan({ takeProfit1: null }), [])!
    expect(l.bands.map((b) => [b.key, b.from])).toEqual([
      ['stop', 100],
      ['tp2', 100],
    ])
  })

  it('띠가 하나도 없으면 그리지 않는다', () => {
    expect(riskBandLayout(plan({ stopLoss: null, takeProfit1: null, takeProfit2: null }), [100])).toBeNull()
  })
})

describe('spreadLabels', () => {
  it('충분히 떨어져 있으면 그대로 둔다', () => {
    expect(spreadLabels([10, 60, 120], 20, 0, 200)).toEqual([10, 60, 120])
  })

  it('가까운 이름표는 gap 만큼 벌리고 원래 순서를 지킨다', () => {
    expect(spreadLabels([50, 40], 20, 0, 200)).toEqual([60, 40])
  })

  it('아래 경계를 넘으면 위로 되민다', () => {
    expect(spreadLabels([190, 195], 20, 0, 200)).toEqual([180, 200])
  })
})
