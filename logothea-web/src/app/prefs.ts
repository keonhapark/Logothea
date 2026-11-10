import { create } from 'zustand'

/**
 * 내 정보 > 설정의 켜고 끄기. 이 웹에서 바로 바뀌는 것만 둔다. 값은 localStorage 에 두고, 읽기 · 쓰기가 막혀도
 * 기본값(둘 다 켬)으로 동작한다.
 */

const STORAGE_KEY = 'logothea.web.prefs'

export interface Prefs {
  /** 자막 아래 번역을 함께 보인다. */
  showTranslation: boolean
  /** 번역의 용어에 밑줄을 긋는다. */
  glossaryUnderline: boolean
}

export const DEFAULT_PREFS: Prefs = { showTranslation: true, glossaryUnderline: true }

export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>
    return {
      showTranslation: typeof value.showTranslation === 'boolean' ? value.showTranslation : DEFAULT_PREFS.showTranslation,
      glossaryUnderline: typeof value.glossaryUnderline === 'boolean' ? value.glossaryUnderline : DEFAULT_PREFS.glossaryUnderline,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function load(): Prefs {
  try {
    return parsePrefs(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

interface PrefsState extends Prefs {
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  set: (key, value) => {
    set({ [key]: value } as Pick<Prefs, typeof key>)
    const { showTranslation, glossaryUnderline } = get()
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showTranslation, glossaryUnderline }))
    } catch {
      // 저장하지 못하면 이번 방문 동안만 유지된다
    }
  },
}))
