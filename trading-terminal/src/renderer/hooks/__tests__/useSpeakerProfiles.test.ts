import { describe, it, expect } from 'vitest'
import { hasSpeakerRoster } from '../useSpeakerProfiles'
import { DEMO_TICKER } from '../../constants/demo'

describe('hasSpeakerRoster', () => {
  it('시연 종목 콜 화면에서만 명부를 쓴다', () => {
    expect(hasSpeakerRoster(DEMO_TICKER)).toBe(true)
    expect(hasSpeakerRoster('AAPL')).toBe(false)
    expect(hasSpeakerRoster(DEMO_TICKER.toLowerCase())).toBe(false)
    expect(hasSpeakerRoster(null)).toBe(false)
  })
})
