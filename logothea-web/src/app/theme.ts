import { useSyncExternalStore } from 'react'
import { parseThemeChoice, resolveTheme, THEME_STORAGE_KEY, WINDOW_BACKGROUND, type ThemeChoice } from '@terminal/lib/theme'

/**
 * 화면 테마. 첫 프레임은 public/theme-boot.js 가 칠하고, 그 뒤 전환과 기기 설정 추종은 여기서 맡는다.
 * 선택값 해석은 터미널 src/lib/theme.ts 를 그대로 쓴다. tokens.css 는 `:root` 가 다크라서 `기기 설정` 도
 * 늘 data-theme 를 풀어 둔다.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()
let current: ThemeChoice = readStored()

function readStored(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return parseThemeChoice(null)
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true
}

export function paintTheme(choice: ThemeChoice = current): void {
  const root = document.documentElement
  const next = resolveTheme(choice, systemPrefersDark())
  // 브라우저 상단 바 색도 고른 테마에 맞춘다(기기 설정과 다른 테마를 골랐을 때)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute('media')
    meta.content = WINDOW_BACKGROUND[next]
  }
  if (root.dataset.theme === next) return
  root.classList.add('theme-switching')
  root.dataset.theme = next
  void root.offsetHeight
  requestAnimationFrame(() => root.classList.remove('theme-switching'))
}

export function setThemeChoice(choice: ThemeChoice): void {
  current = choice
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // 저장하지 못하면 다음 방문 때 기기 설정으로 돌아간다
  }
  paintTheme(choice)
  for (const listener of listeners) listener()
}

/** 기기 설정이 바뀌면 `기기 설정` 을 고른 동안만 따라간다. */
export function installThemeSync(): () => void {
  const query = window.matchMedia?.(DARK_QUERY)
  const onChange = () => {
    if (current === 'system') paintTheme('system')
  }
  query?.addEventListener('change', onChange)
  paintTheme()
  return () => query?.removeEventListener('change', onChange)
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
  )
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: '기기 설정',
  light: '라이트',
  dark: '다크',
}
