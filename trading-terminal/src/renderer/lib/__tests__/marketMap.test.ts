import { describe, it, expect } from 'vitest'
import { changeIntensity, groupBySector, squarify, topByMarketCap } from '../marketMap'
import type { Sp500Stock } from '../../../lib/types/stockList'

const st = (ticker: string, cap: number | null, sector: string | null = 'IT', rank?: number | null): Sp500Stock => ({
  ticker,
  companyName: ticker,
  sector,
  marketCapUsd: cap,
  marketCapRank: rank,
  currentPrice: 1,
  changePercent: 0,
})

describe('topByMarketCap', () => {
  it('서버 순위가 있으면 순위 N 이하를 순위 순으로 고른다', () => {
    const list = [st('C', 10, 'IT', 3), st('A', 30, 'IT', 1), st('B', 20, 'IT', 2), st('X', null, 'IT', null)]
    expect(topByMarketCap(list, 2).map((s) => s.ticker)).toEqual(['A', 'B'])
  })

  it('순위가 없는 옛 응답이면 시가총액 순으로 N 개', () => {
    const list = [st('A', 10), st('B', 30), st('C', 20), st('D', null), st('E', 0)]
    expect(topByMarketCap(list, 2).map((s) => s.ticker)).toEqual(['B', 'C'])
  })
})

describe('groupBySector', () => {
  it('섹터 합이 큰 순서, 섹터 안은 시가총액 순, 섹터가 없으면 기타', () => {
    const g = groupBySector([st('A', 10, 'IT'), st('B', 50, 'Energy'), st('C', 30, 'IT'), st('D', 5, null)])
    expect(g.map((x) => [x.sector, x.value])).toEqual([
      ['Energy', 50],
      ['IT', 40],
      ['기타', 5],
    ])
    expect(g[1].stocks.map((s) => s.ticker)).toEqual(['C', 'A'])
  })
})

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 600, h: 400 }
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ value: v, item: i }))

  it('면적은 값에 비례하고 합은 사각형 면적과 같다', () => {
    const tiles = squarify(items, rect)
    expect(tiles).toHaveLength(7)
    const total = tiles.reduce((s, t) => s + t.w * t.h, 0)
    expect(total).toBeCloseTo(600 * 400)
    expect(tiles[0].w * tiles[0].h).toBeCloseTo((6 / 24) * 600 * 400)
  })

  it('모든 칸이 사각형 안에 있고 서로 겹치지 않는다', () => {
    const tiles = squarify(items, rect)
    const eps = 1e-6
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-eps)
      expect(t.y).toBeGreaterThanOrEqual(-eps)
      expect(t.x + t.w).toBeLessThanOrEqual(600 + eps)
      expect(t.y + t.h).toBeLessThanOrEqual(400 + eps)
    }
    for (let i = 0; i < tiles.length; i++)
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i]
        const b = tiles[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(ox <= eps || oy <= eps).toBe(true)
      }
  })

  it('값이 0 이하인 항목과 빈 사각형은 칸을 만들지 않는다', () => {
    expect(squarify([{ value: 0, item: 'a' }, { value: -1, item: 'b' }], rect)).toEqual([])
    expect(squarify([{ value: 1, item: 'a' }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
  })

  it('칸의 가로세로비가 지나치게 길쭉하지 않다', () => {
    const tiles = squarify(items, rect)
    for (const t of tiles) expect(Math.max(t.w / t.h, t.h / t.w)).toBeLessThan(4)
  })
})

describe('changeIntensity', () => {
  it('±3% 에서 가득 차고, 모르면 null', () => {
    expect(changeIntensity(1.5)).toBe(0.5)
    expect(changeIntensity(-6)).toBe(1)
    expect(changeIntensity(0)).toBe(0)
    expect(changeIntensity(null)).toBeNull()
    expect(changeIntensity(Number.NaN)).toBeNull()
  })
})
