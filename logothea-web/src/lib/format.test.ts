import { describe, expect, it } from 'vitest'
import { elapsedLabel, kstClock, kstFullDateTime, kstShortDateTime, priceDirClass, signedPercent } from './format'

// 2026-11-14 12:00 UTC = 21:00 KST (토)
const T = Date.UTC(2026, 10, 14, 12, 0) / 1000

describe('한국 시간 표기', () => {
  it('기기 시간대와 관계없이 KST 24시간제로 쓴다', () => {
    expect(kstClock(T)).toBe('21:00')
    expect(kstShortDateTime(T)).toBe('11/14 토 21:00')
    expect(kstFullDateTime(T)).toContain('2026년 11월 14일')
    expect(kstFullDateTime(T)).toContain('21:00')
  })

  it('자정을 넘기면 날짜가 KST 기준으로 바뀐다', () => {
    const utc1530 = Date.UTC(2026, 10, 14, 15, 30) / 1000 // 00:30 KST 다음 날
    expect(kstShortDateTime(utc1530)).toBe('11/15 일 00:30')
  })
})

describe('elapsedLabel', () => {
  it.each([
    [0, '방금 시작'],
    [59_999, '방금 시작'],
    [60_000, '1분째 진행'],
    [18 * 60_000 + 42_000, '18분째 진행'],
  ])('%i → %s', (ms, label) => {
    expect(elapsedLabel(ms)).toBe(label)
  })
})

describe('signedPercent · priceDirClass', () => {
  it('하락은 빼기 기호, 0 은 부호 없음', () => {
    expect(signedPercent(0.42)).toBe('+0.42%')
    expect(signedPercent(-0.08)).toBe('−0.08%')
    expect(signedPercent(0)).toBe('0.00%')
    expect(signedPercent(0.1, 2, '%p')).toBe('+0.10%p')
  })

  it('가격 색은 등락 방향만 본다', () => {
    expect(priceDirClass(1)).toBe('up')
    expect(priceDirClass(-1)).toBe('down')
    expect(priceDirClass(0)).toBe('')
    expect(priceDirClass(null)).toBe('')
    expect(priceDirClass(Number.NaN)).toBe('')
  })
})
