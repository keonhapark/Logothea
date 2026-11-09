import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CALL_TOUR_STORAGE_KEY, isCallTourDone, markCallTourDone, resetCallTour } from '../callTour'

// node 환경이라 localStorage 를 직접 둔다
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callTour', () => {
  it('처음에는 보지 않았고, 끝내면 본 것으로 기억한다', () => {
    expect(isCallTourDone()).toBe(false)
    markCallTourDone()
    expect(isCallTourDone()).toBe(true)
    expect(localStorage.getItem(CALL_TOUR_STORAGE_KEY)).toBe('1')
  })

  it('다시 보기를 누르면 다음에 다시 뜬다', () => {
    markCallTourDone()
    resetCallTour()
    expect(isCallTourDone()).toBe(false)
  })

  it('저장소를 읽지 못하면 본 것으로 둔다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(isCallTourDone()).toBe(true)
  })
})
