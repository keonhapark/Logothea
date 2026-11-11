import { describe, expect, it, vi } from 'vitest'
import { HIDDEN_THRESHOLD_MS, installPageLifecycle } from './pageLifecycle'
import type { WsStatus } from './stomp'

function setup(status: WsStatus = 'CONNECTED') {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const win = new EventTarget()
  let clock = 0
  const stomp = { status, reconnectNow: vi.fn(async () => undefined) }
  const uninstall = installPageLifecycle(stomp, { document: doc, window: win, now: () => clock })
  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state
    doc.dispatchEvent(new Event('visibilitychange'))
  }
  return { stomp, win, setVisibility, advance: (ms: number) => (clock += ms), uninstall }
}

describe('installPageLifecycle', () => {
  it('오래 가려졌다가 다시 보이면 새로 붙는다', () => {
    const s = setup()
    s.setVisibility('hidden')
    s.advance(HIDDEN_THRESHOLD_MS)
    s.setVisibility('visible')
    expect(s.stomp.reconnectNow).toHaveBeenCalledTimes(1)
  })

  it('잠깐 가려졌다 보이면 그대로 둔다', () => {
    const s = setup()
    s.setVisibility('hidden')
    s.advance(HIDDEN_THRESHOLD_MS - 1)
    s.setVisibility('visible')
    expect(s.stomp.reconnectNow).not.toHaveBeenCalled()
  })

  it('온라인 복귀와 bfcache 복원 때 새로 붙는다(일반 pageshow 는 제외)', () => {
    const s = setup()
    s.win.dispatchEvent(new Event('online'))
    s.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    s.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(s.stomp.reconnectNow).toHaveBeenCalledTimes(2)
  })

  it('끊긴 상태(시작 전 · 의도적 종료)에서는 아무것도 하지 않는다', () => {
    const s = setup('DISCONNECTED')
    s.win.dispatchEvent(new Event('online'))
    expect(s.stomp.reconnectNow).not.toHaveBeenCalled()
  })

  it('해제하면 더 이상 반응하지 않는다', () => {
    const s = setup()
    s.uninstall()
    s.win.dispatchEvent(new Event('online'))
    expect(s.stomp.reconnectNow).not.toHaveBeenCalled()
  })
})
