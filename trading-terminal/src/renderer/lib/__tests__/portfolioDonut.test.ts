import { describe, it, expect } from 'vitest'
import { donutSlices } from '../portfolioDonut'

const h = (ticker: string, marketValue: number) => ({ ticker, name: `${ticker} Inc.`, marketValue })

describe('donutSlices', () => {
  it('보유도 현금도 없으면 조각이 없다', () => {
    expect(donutSlices([], 0)).toEqual([])
  })

  it('평가금액이 큰 순서이고 현금은 마지막 조각이다', () => {
    const s = donutSlices([h('A', 100), h('B', 300)], 600)
    expect(s.map((x) => x.key)).toEqual(['B', 'A', 'CASH'])
    expect(s.map((x) => x.weight)).toEqual([0.3, 0.1, 0.6])
  })

  it('비중의 합은 1이다', () => {
    const s = donutSlices([h('A', 123.4), h('B', 56.7), h('C', 8.9)], 77.7)
    expect(s.reduce((acc, x) => acc + x.weight, 0)).toBeCloseTo(1)
  })

  it('색을 줄 수 있는 수를 넘으면 나머지를 기타로 묶는다', () => {
    const s = donutSlices([h('A', 60), h('B', 50), h('C', 40), h('D', 30)], 0, 2)
    expect(s.map((x) => x.key)).toEqual(['A', 'B', 'OTHER'])
    expect(s[2]).toMatchObject({ kind: 'other', count: 2, value: 70, label: '기타 2종목' })
  })

  it('묶일 종목이 하나뿐이면 기타로 감추지 않는다', () => {
    const s = donutSlices([h('A', 60), h('B', 50), h('C', 40)], 0, 2)
    expect(s.map((x) => x.key)).toEqual(['A', 'B', 'C'])
  })

  it('평가금액이 0 이하이거나 숫자가 아닌 종목과 0 원 현금은 빼고 나눈다', () => {
    const s = donutSlices([h('A', 100), h('B', 0), h('C', Number.NaN)], 0)
    expect(s).toEqual([{ key: 'A', label: 'A Inc.', value: 100, weight: 1, kind: 'stock' }])
  })
})
