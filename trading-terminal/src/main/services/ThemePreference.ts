import { app, nativeTheme } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseThemeChoice, resolveTheme, WINDOW_BACKGROUND, type ThemeChoice } from '../../lib/theme'

/**
 * 테마 선택을 창(nativeTheme · 창 바탕색)에 반영하고 다음 실행을 위해 기억한다.
 *
 * 선택의 원본은 renderer 의 localStorage 다. main 이 따로 기억하는 이유는 창을 만들 때(화면을 그리기 전)
 * 바탕색을 정해야 해서다. localStorage 는 창이 뜬 뒤에야 읽을 수 있다.
 *
 * 비밀 정보가 아니므로 디스크(userData/theme.json)에 쓴다. 토큰 · 키를 디스크에 쓰지 않는 원칙
 * (store/mainState.ts)과는 관계없다.
 */

const FILE_NAME = 'theme.json'

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 기억한 선택을 읽는다. 파일이 없거나 깨졌으면 기본값(`system`)이다. 창을 만들기 전에 불러서 동기로 읽는다. */
export function loadThemeChoice(): ThemeChoice {
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8')) as { theme?: unknown }
    return parseThemeChoice(parsed?.theme)
  } catch {
    return parseThemeChoice(undefined)
  }
}

/**
 * 동기로 쓴다. 비동기 쓰기는 빠르게 연달아 바꿀 때 두 쓰기가 겹쳐 파일이 깨지거나 이전 값이 남을 수 있다.
 * 수십 바이트라 동기로 써도 멈춤이 없다.
 */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    writeFileSync(filePath(), JSON.stringify({ theme: choice }), 'utf8')
  } catch (e) {
    // 기억하지 못해도 이번 실행의 화면은 이미 바뀌었다. 다음 실행 첫 순간 바탕색만 어긋난다.
    console.warn('[ThemePreference] 테마 저장 실패:', e)
  }
}

/**
 * 창 테마를 선택에 맞춘다. 선택값을 그대로 넘기므로 `system` 이면 운영체제 설정을 따른다.
 * renderer 의 `prefers-color-scheme` 도 이 값을 따라 바뀐다.
 */
export function applyNativeTheme(choice: ThemeChoice): void {
  nativeTheme.themeSource = choice
}

/** 지금 창 테마에 맞는 바탕색. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/**
 * 시작할 때의 창 바탕색. 기억한 선택을 운영체제 설정으로 풀어서 고른다.
 *
 * 시작할 때는 창 테마(themeSource)를 기억한 값으로 강제하지 않는다. 강제하면 renderer 의 `prefers-color-scheme`
 * 이 그 값을 보이므로, localStorage(원본)와 기억이 어긋났을 때 첫 프레임 스크립트가 `system` 을 틀리게 풀어
 * 다른 테마가 잠깐 보인다. 창 테마는 renderer 가 시작하면서 선택을 알려 올 때 맞춘다.
 */
export function startupWindowBackground(): string {
  return WINDOW_BACKGROUND[resolveTheme(loadThemeChoice(), nativeTheme.shouldUseDarkColors)]
}
