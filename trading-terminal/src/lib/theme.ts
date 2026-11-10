/**
 * 테마 선택 값. main 과 renderer 가 같이 쓴다.
 *
 * - `system`: 운영체제 설정(밝은 화면 · 어두운 화면)을 따른다. 기본값이다.
 * - `light` · `dark`: 그 테마로 고정한다.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

/** 화면에 실제로 그리는 테마. `system` 을 풀어낸 결과다. */
export type ResolvedTheme = 'light' | 'dark'

export const DEFAULT_THEME_CHOICE: ThemeChoice = 'system'

/**
 * renderer 가 선택을 저장하는 localStorage 키.
 * 첫 프레임 스크립트(src/renderer/public/theme-boot.js)도 같은 키를 읽는다. 그 파일은 모듈을 불러올 수 없어
 * 같은 문자열을 따로 적었다. 바꿀 때 두 곳을 같이 바꾼다.
 */
export const THEME_STORAGE_KEY = 'logothea.theme'

/**
 * 테마별 창 바탕색. tokens.css 의 `--bg-rgb` 와 같은 값이다.
 * 화면을 그리기 전에 창이 이 색으로 먼저 칠해지므로, 다르면 시작할 때 한 번 번쩍인다.
 */
export const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: '#ebe9e3',
  dark: '#16171b',
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 저장된 값을 읽는다. 없거나 알 수 없는 값이면 기본값(`system`)이다. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return isThemeChoice(value) ? value : DEFAULT_THEME_CHOICE
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light'
  return choice
}
