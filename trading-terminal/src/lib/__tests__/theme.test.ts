import { describe, it, expect } from 'vitest'
import { isThemeChoice, parseThemeChoice, resolveTheme } from '../theme'

describe('theme — 선택 값', () => {
  it('세 값만 테마 선택으로 인정한다', () => {
    expect(isThemeChoice('system')).toBe(true)
    expect(isThemeChoice('light')).toBe(true)
    expect(isThemeChoice('dark')).toBe(true)
    expect(isThemeChoice('Dark')).toBe(false)
    expect(isThemeChoice('')).toBe(false)
    expect(isThemeChoice(null)).toBe(false)
    expect(isThemeChoice(1)).toBe(false)
  })

  it('저장값이 없거나 알 수 없으면 시스템 설정 따름으로 읽는다', () => {
    expect(parseThemeChoice(null)).toBe('system')
    expect(parseThemeChoice(undefined)).toBe('system')
    expect(parseThemeChoice('sepia')).toBe('system')
    expect(parseThemeChoice('light')).toBe('light')
  })

  it('system 은 운영체제 설정으로, 고정 선택은 그대로 푼다', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
