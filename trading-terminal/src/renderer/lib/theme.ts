import { ipc, IPC_CHANNELS } from './ipc'
import { parseThemeChoice, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice } from '../../lib/theme'

/**
 * 화면 테마 전환. 첫 프레임은 public/theme-boot.js 가 칠하고, 그 뒤의 전환과 시스템 설정 추종은 여기서 맡는다.
 *
 * 선택의 원본은 localStorage 다. main 에도 알려서 창 테마(nativeTheme)와 창 바탕색을 맞춘다.
 * main 이 창 테마를 선택값으로 두므로 `prefers-color-scheme` 은 `system` 일 때만 운영체제 설정을 그대로 보인다.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

let current: ThemeChoice = parseThemeChoice(null)

function readStoredChoice(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return parseThemeChoice(null)
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true
}

/**
 * `<html data-theme>` 을 바꾼다. 바꾸는 순간에는 transition 을 꺼 둔다 — 켜 두면 요소마다 정해진 시간 차로
 * 색이 따로 바뀌어 화면이 얼룩져 보인다.
 */
function paint(choice: ThemeChoice): void {
  const root = document.documentElement
  const next = resolveTheme(choice, systemPrefersDark())
  if (root.dataset.theme === next) return
  root.classList.add('theme-switching')
  root.dataset.theme = next
  // 스타일을 지금 계산시켜 새 색이 transition 없이 들어가게 한 뒤 다음 프레임에 원래대로 돌린다
  void root.offsetHeight
  requestAnimationFrame(() => root.classList.remove('theme-switching'))
}

async function notifyMain(choice: ThemeChoice): Promise<void> {
  try {
    await ipc.invoke(IPC_CHANNELS.SETTINGS_SET_THEME, choice)
  } catch (e) {
    // main 이 받지 못해도 화면 테마는 바뀐다. 창 바탕색과 다음 실행 첫 순간 색만 어긋난다.
    console.warn('[theme] main 에 테마 알림 실패:', e)
  }
}

export function getThemeChoice(): ThemeChoice {
  return current
}

/**
 * 선택을 바꾼다. main 이 창 테마를 먼저 바꾼 뒤에 칠한다 — `system` 으로 돌아갈 때
 * `prefers-color-scheme` 이 운영체제 값으로 돌아온 다음이어야 맞는 테마를 고른다.
 * 빠르게 연달아 바꿔도 마지막 선택으로 칠하도록 응답 뒤에 `current` 를 다시 읽는다.
 */
export async function setThemeChoice(choice: ThemeChoice): Promise<void> {
  current = choice
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // 저장하지 못하면 다음 실행 때 기본값(시스템 설정 따름)으로 돌아간다
  }
  await notifyMain(choice)
  paint(current)
}

/** 앱 시작 때 한 번 부른다. 저장된 선택을 main 에 다시 알리고(기억이 어긋났을 때 맞추려고) 시스템 설정 변화를 따라간다. */
export function initTheme(): void {
  current = readStoredChoice()
  paint(current)
  void notifyMain(current).then(() => paint(current))
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => paint(current))
}
