import { describe, expect, it } from 'vitest'
import { limitRows, scheduleRows } from './Home'
import { tileColor } from './Market'
import type { EarningsEvent, EarningsTimelineData } from '@terminal/lib/types/earningsTimeline'

const ev = (ticker: string): EarningsEvent => ({ ticker, name: ticker, scheduledAt: 1, timeLabel: '' })

describe('scheduleRows', () => {
  it('일정의 live 추정 콜도 오늘 묶음 맨 앞에 둔다(홈 카드는 시연 방송만 다룬다)', () => {
    const data: EarningsTimelineData = {
      live: { ...ev('HD'), elapsed: '01:00', callLabel: 'Earnings Call' },
      groups: [{ kind: 'today', label: '오늘', events: [ev('TGT')] }],
    }
    expect(scheduleRows(data)[0].events.map((e) => e.ticker)).toEqual(['HD', 'TGT'])
  })

  it('입력을 바꾸지 않아 같은 일정으로 두 번 불러도 결과가 같다(StrictMode 이중 호출)', () => {
    const data: EarningsTimelineData = {
      live: { ...ev('HD'), elapsed: '01:00', callLabel: 'Earnings Call' },
      groups: [{ kind: 'today', label: '오늘', events: [ev('TGT')] }],
    }
    const first = scheduleRows(data)
    const second = scheduleRows(data)
    expect(second).toEqual(first)
    expect(data.groups[0].events.map((e) => e.ticker)).toEqual(['TGT'])
  })

  it('오늘 묶음이 없으면 새로 만든다', () => {
    const data: EarningsTimelineData = {
      live: { ...ev('HD'), elapsed: '01:00', callLabel: 'Earnings Call' },
      groups: [{ kind: 'tomorrow', label: '내일', events: [ev('NVDA')] }],
    }
    expect(scheduleRows(data).map((g) => g.kind)).toEqual(['today', 'tomorrow'])
  })
})

describe('limitRows', () => {
  const groups = [
    { kind: 'a', events: [1, 2, 3] },
    { kind: 'b', events: [4, 5] },
    { kind: 'c', events: [6] },
  ]
  it('앞에서부터 limit 행만 남기고 빈 묶음은 뺀다', () => {
    expect(limitRows(groups, 4)).toEqual([
      { kind: 'a', events: [1, 2, 3] },
      { kind: 'b', events: [4] },
    ])
    expect(limitRows(groups, 3).map((g) => g.kind)).toEqual(['a'])
    expect(limitRows(groups, 10)).toEqual(groups)
    expect(limitRows(groups, 0)).toEqual([])
  })
})

describe('tileColor (데스크톱 MarketMap 과 같은 식)', () => {
  it('모르면 회색, 0 은 옅은 무채색, 상승 빨강 · 하락 파랑이고 ±3% 에서 가장 진하다', () => {
    expect(tileColor(null)).toBe('rgb(var(--ink-rgb) / 0.07)')
    expect(tileColor(0)).toBe('rgb(var(--ink-rgb) / 0.12)')
    expect(tileColor(3)).toBe('rgb(var(--up-rgb) / 0.800)')
    expect(tileColor(-9)).toBe('rgb(var(--down-rgb) / 0.800)')
    expect(tileColor(1.5)).toMatch(/^rgb\(var\(--up-rgb\) \/ 0\.[2-7]\d\d\)$/)
  })
})
