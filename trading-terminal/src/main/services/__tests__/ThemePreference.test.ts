import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app, nativeTheme } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// setup.ts 의 electron mock(app.getPath · nativeTheme)을 쓴다.
import { applyNativeTheme, loadThemeChoice, saveThemeChoice, startupWindowBackground, windowBackground } from '../ThemePreference'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theme-pref-'))
  vi.mocked(app.getPath).mockReturnValue(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ThemePreference — 마지막 선택 기억', () => {
  it('파일이 없으면 시스템 설정 따름이다', () => {
    expect(loadThemeChoice()).toBe('system')
  })

  it('저장한 선택을 다음 실행에 읽는다', () => {
    saveThemeChoice('light')
    expect(loadThemeChoice()).toBe('light')
    saveThemeChoice('dark')
    expect(loadThemeChoice()).toBe('dark')
  })

  it('파일이 깨졌거나 모르는 값이면 시스템 설정 따름이다', () => {
    writeFileSync(join(dir, 'theme.json'), '{not json')
    expect(loadThemeChoice()).toBe('system')
    writeFileSync(join(dir, 'theme.json'), JSON.stringify({ theme: 'sepia' }))
    expect(loadThemeChoice()).toBe('system')
    writeFileSync(join(dir, 'theme.json'), 'null')
    expect(loadThemeChoice()).toBe('system')
  })

  it('저장에 실패해도 던지지 않는다', () => {
    vi.mocked(app.getPath).mockReturnValue(join(dir, 'missing', 'nested'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => saveThemeChoice('dark')).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})

describe('ThemePreference — 창 테마', () => {
  it('선택값을 nativeTheme.themeSource 에 그대로 넣는다', () => {
    applyNativeTheme('light')
    expect(nativeTheme.themeSource).toBe('light')
    applyNativeTheme('system')
    expect(nativeTheme.themeSource).toBe('system')
  })

  it('창 바탕색은 지금 창 테마의 어둡기를 따른다', () => {
    const theme = nativeTheme as { shouldUseDarkColors: boolean }
    theme.shouldUseDarkColors = true
    expect(windowBackground()).toBe('#16171b')
    theme.shouldUseDarkColors = false
    expect(windowBackground()).toBe('#ebe9e3')
    theme.shouldUseDarkColors = true
  })

  it('시작 바탕색은 기억한 선택을 운영체제 설정으로 푼다', () => {
    const theme = nativeTheme as { shouldUseDarkColors: boolean }
    theme.shouldUseDarkColors = true
    expect(startupWindowBackground()).toBe('#16171b') // 기억 없음 → system → 운영체제 다크
    saveThemeChoice('light')
    expect(startupWindowBackground()).toBe('#ebe9e3')
    saveThemeChoice('system')
    theme.shouldUseDarkColors = false
    expect(startupWindowBackground()).toBe('#ebe9e3')
    saveThemeChoice('dark')
    expect(startupWindowBackground()).toBe('#16171b')
    theme.shouldUseDarkColors = true
  })
})
