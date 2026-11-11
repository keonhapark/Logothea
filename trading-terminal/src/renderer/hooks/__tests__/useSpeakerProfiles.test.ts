import { describe, it, expect } from 'vitest'
import { hasSpeakerRoster } from '../useSpeakerProfiles'
import { DEMO_TICKER, DEMO_TICKERS, isDemoTicker } from '../../constants/demo'

describe('hasSpeakerRoster', () => {
  it('시연 대본이 있는 종목 콜 화면에서만 명부를 쓴다', () => {
    expect(hasSpeakerRoster(DEMO_TICKER)).toBe(true)
    expect(hasSpeakerRoster('NVDA')).toBe(true)
    expect(hasSpeakerRoster('AAPL')).toBe(false)
    expect(hasSpeakerRoster(DEMO_TICKER.toLowerCase())).toBe(false)
    expect(hasSpeakerRoster(null)).toBe(false)
  })
})

describe('DEMO_TICKERS', () => {
  it('기본 시연 종목(웹 반복 방송)을 포함한다', () => {
    expect(DEMO_TICKERS).toContain(DEMO_TICKER)
    expect(isDemoTicker(undefined)).toBe(false)
  })
})
