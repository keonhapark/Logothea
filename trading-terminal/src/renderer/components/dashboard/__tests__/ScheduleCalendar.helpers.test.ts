import { describe, expect, it } from 'vitest'
import {
  computeMonthGrid,
  formatKstDateHeader,
  toKstDateKey,
} from '../ScheduleCalendar'

describe('ScheduleCalendar 헬퍼', () => {
  it('epoch 초를 KST 기준 YYYY-MM-DD 로 변환한다', () => {
    // 2026-11-11 12:00:00 UTC = 2026-11-11 21:00:00 KST
    const epochSec1 = 1794398400
    expect(toKstDateKey(epochSec1)).toBe('2026-11-11')

    // 2026-11-11 16:00:00 UTC = 2026-11-12 01:00:00 KST (날짜가 다음 날로 넘어감)
    const epochSec2 = 1794412800
    expect(toKstDateKey(epochSec2)).toBe('2026-11-12')
  })

  it('YYYY-MM-DD 날짜를 한국어 헤더(M월 D일 요일)로 변환한다', () => {
    expect(formatKstDateHeader('2026-11-11')).toBe('11월 11일 (수)')
    expect(formatKstDateHeader('2026-11-12')).toBe('11월 12일 (목)')
    expect(formatKstDateHeader('2026-11-15')).toBe('11월 15일 (일)')
  })

  it('특정 연/월의 달력 격자(이전 달 잔여 일자 및 당월 일자)를 정확히 계산한다', () => {
    // 2026년 11월: 11월 1일은 일요일(0), 11월은 30일까지 있음
    const nov2026 = computeMonthGrid(2026, 11)
    expect(nov2026.prevTrailingDays).toEqual([])
    expect(nov2026.currentMonthDays).toHaveLength(30)
    expect(nov2026.currentMonthDays[0]).toBe(1)
    expect(nov2026.currentMonthDays[29]).toBe(30)

    // 2026년 12월: 12월 1일은 화요일(2), 이전 달(11월) 30, 29 중 2일(29, 30)이 앞에 붙음
    const dec2026 = computeMonthGrid(2026, 12)
    expect(dec2026.prevTrailingDays).toEqual([29, 30])
    expect(dec2026.currentMonthDays).toHaveLength(31)
  })
})
