import { describe, it, expect } from 'vitest'
import { planCallStartAlerts, CALL_START_HORIZON_MS } from '../callStartAlerts'
import type { EarningsTimelineData } from '../../../lib/types/earningsTimeline'

const NOW = 1_800_000_000_000
const sec = (ms: number) => Math.floor(ms / 1000)

function timeline(...events: { ticker: string; at: number }[]): EarningsTimelineData {
  return {
    live: null,
    groups: [{ kind: 'today', label: '오늘', events: events.map((e) => ({ ticker: e.ticker, name: `${e.ticker} Inc.`, scheduledAt: sec(e.at), timeLabel: '' })) }],
  }
}

describe('planCallStartAlerts', () => {
  it('관심 · 보유 종목의 콜만 시작 몇 분 전에 알린다', () => {
    const tl = timeline({ ticker: 'WMT', at: NOW + 60 * 60_000 }, { ticker: 'PEP', at: NOW + 60 * 60_000 })
    const alerts = planCallStartAlerts(tl, new Set(['WMT']), 10, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ ticker: 'WMT', companyName: 'WMT Inc.', delayMs: 50 * 60_000 })
  })

  it('알릴 때가 지났어도 콜이 아직 시작 전이면 바로 알린다', () => {
    const tl = timeline({ ticker: 'WMT', at: NOW + 3 * 60_000 })
    expect(planCallStartAlerts(tl, new Set(['WMT']), 10, NOW)[0].delayMs).toBe(0)
  })

  it('이미 시작한 콜은 알리지 않는다', () => {
    const tl = timeline({ ticker: 'WMT', at: NOW - 60_000 }, { ticker: 'AAPL', at: NOW })
    expect(planCallStartAlerts(tl, new Set(['WMT', 'AAPL']), 10, NOW)).toEqual([])
  })

  it('알린 콜은 건너뛰고, 같은 콜이 두 번 와도 한 번만 고른다', () => {
    const at = NOW + 30 * 60_000
    const tl = timeline({ ticker: 'WMT', at }, { ticker: 'WMT', at })
    expect(planCallStartAlerts(tl, new Set(['WMT']), 10, NOW)).toHaveLength(1)
    expect(planCallStartAlerts(tl, new Set(['WMT']), 10, NOW, new Set([`WMT-${sec(at)}`]))).toEqual([])
  })

  it('먼 일정은 타이머를 걸지 않는다', () => {
    const tl = timeline({ ticker: 'WMT', at: NOW + CALL_START_HORIZON_MS + 11 * 60_000 })
    expect(planCallStartAlerts(tl, new Set(['WMT']), 10, NOW)).toEqual([])
  })
  it('30분 안으로 다가와 live 로 옮겨진 콜도 알린다', () => {
    const at = NOW + 20 * 60_000
    const tl: EarningsTimelineData = {
      live: { ticker: 'WMT', name: 'Walmart Inc.', scheduledAt: sec(at), timeLabel: '', elapsed: '', callLabel: '' },
      groups: [],
    }
    expect(planCallStartAlerts(tl, new Set(['WMT']), 10, NOW)).toEqual([
      { key: `WMT-${sec(at)}`, ticker: 'WMT', companyName: 'Walmart Inc.', scheduledAt: sec(at), delayMs: 10 * 60_000 },
    ])
  })
})
