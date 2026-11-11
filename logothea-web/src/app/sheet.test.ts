import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 시트 · 경로의 history 처리. jsdom 없이 history 만 흉내 낸 가짜 window 로 돌린다.
 * back() 은 브라우저처럼 비동기로 popstate 를 보낸다.
 */
class FakeHistory {
  entries: { state: unknown; url: string }[] = [{ state: null, url: '/' }]
  index = 0
  constructor(private readonly win: FakeWindow) {}
  get state() {
    return this.entries[this.index].state
  }
  pushState(state: unknown, _title: string, url?: string) {
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state, url: url ?? this.entries[this.index].url })
    this.index++
  }
  replaceState(state: unknown, _title: string, url?: string) {
    this.entries[this.index] = { state, url: url ?? this.entries[this.index].url }
  }
  back() {
    if (this.index === 0) return
    this.index--
    setTimeout(() => this.win.dispatch('popstate', { state: this.state }), 0)
  }
}

class FakeWindow {
  listeners = new Map<string, Set<(e: unknown) => void>>()
  history = new FakeHistory(this)
  get location() {
    return { pathname: this.history.entries[this.history.index].url }
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn)
  }
  dispatch(type: string, event: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(event)
  }
}

const flush = () => new Promise((r) => setTimeout(r, 5))
let win: FakeWindow

async function load(startState: unknown = null, path = '/') {
  win = new FakeWindow()
  win.history.entries = [{ state: startState, url: path }]
  vi.stubGlobal('window', win)
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', {
    activeElement: null,
    body: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  vi.resetModules()
  const sheet = await import('./sheet')
  const router = await import('./router')
  sheet.installSheetHistory()
  return { sheet, router }
}

const spec = (title: string) => ({ title, body: () => null })

beforeEach(() => vi.useRealTimers())
afterEach(() => vi.unstubAllGlobals())

describe('시트 history', () => {
  it('열면 한 단계 쌓고, 닫으면 그 단계를 지운다', async () => {
    const { sheet } = await load()
    sheet.openSheet(spec('a'))
    expect(win.history.entries).toHaveLength(2)
    sheet.closeSheet()
    await flush()
    expect(win.history.index).toBe(0)
    expect(sheet.isSheetOpen()).toBe(false)
  })

  it('브라우저 뒤로 가기가 시트를 닫는다', async () => {
    const { sheet } = await load()
    sheet.openSheet(spec('a'))
    expect(sheet.isSheetOpen()).toBe(true)
    win.history.back()
    await flush()
    expect(sheet.isSheetOpen()).toBe(false)
    expect(win.history.index).toBe(0)
  })

  it('시트에서 시트를 열면 단계를 더 쌓지 않아 뒤로 가기 한 번에 닫힌다', async () => {
    const { sheet } = await load()
    sheet.openSheet(spec('a'))
    sheet.openSheet(spec('b'))
    expect(win.history.entries).toHaveLength(2)
    sheet.closeSheet()
    await flush()
    expect(win.history.index).toBe(0)
    expect(sheet.isSheetOpen()).toBe(false)
  })

  it('닫기를 두 번 눌러도 한 단계만 뒤로 간다(popstate 가 늦는 브라우저)', async () => {
    const { router, sheet } = await load(null, '/market')
    router.navigate('/me')
    sheet.openSheet(spec('a'))
    sheet.closeSheet()
    sheet.closeSheet()
    await flush()
    expect(win.location.pathname).toBe('/me')
    expect(win.history.index).toBe(1)
  })

  it('시트에서 다른 탭으로 가면 시트 단계를 그 탭으로 바꿔, 뒤로 가면 원래 탭이 나온다', async () => {
    const { sheet } = await load(null, '/market')
    sheet.openSheet(spec('brief'))
    sheet.closeSheetAndGo('/call')
    expect(win.history.entries.map((e) => e.url)).toEqual(['/market', '/call'])
    expect(win.location.pathname).toBe('/call')
    expect(sheet.isSheetOpen()).toBe(false)
  })

  it('시트를 연 채 새로고침하면 남은 시트 단계를 지운다', async () => {
    await load({ sheet: 123 }, '/me')
    expect(win.history.state).toBeNull()
  })

  it('새로고침 뒤 연 시트의 표식은 이전 단계와 겹치지 않는다', async () => {
    const { sheet } = await load(null, '/me')
    sheet.openSheet(spec('a'))
    const token = (win.history.state as { sheet: number }).sheet
    expect(token).toBeGreaterThan(1)
  })
})

describe('navigate', () => {
  it('같은 탭이면 쌓지 않고, 다른 탭이면 쌓는다', async () => {
    const { router } = await load(null, '/')
    router.navigate('/')
    expect(win.history.entries).toHaveLength(1)
    router.navigate('/market')
    expect(win.history.entries.map((e) => e.url)).toEqual(['/', '/market'])
    router.navigate('/me', { replace: true })
    expect(win.history.entries.map((e) => e.url)).toEqual(['/', '/me'])
  })

  it('모르는 경로로 들어오면 홈으로 바꾼다', async () => {
    await load(null, '/nope')
    expect(win.location.pathname).toBe('/')
  })
})
