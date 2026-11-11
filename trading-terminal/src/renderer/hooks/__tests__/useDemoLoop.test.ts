import { describe, it, expect, vi, afterEach } from 'vitest'
import { isLoopStatus, startLoopPolling } from '../useDemoLoop'

describe('isLoopStatus', () => {
  it('loop 가 true 일 때만 반복 방송으로 본다', () => {
    expect(isLoopStatus({ running: true, ticker: 'WMT', callId: 'c', loop: true })).toBe(true)
    expect(isLoopStatus({ running: true, ticker: 'WMT', callId: 'c', loop: false })).toBe(false)
    expect(isLoopStatus({ running: true })).toBe(false)
    expect(isLoopStatus({ loop: 'true' })).toBe(false)
    expect(isLoopStatus(null)).toBe(false)
    expect(isLoopStatus(undefined)).toBe(false)
  })
})

describe('startLoopPolling', () => {
  afterEach(() => vi.useRealTimers())

  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('종목을 실어 바로 한 번, 그 뒤 간격마다 묻는다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const fetchStatus = vi.fn().mockResolvedValue({ loop: true })
    const onLoop = vi.fn()
    const stop = startLoopPolling({ ticker: 'WMT', fetchStatus, onLoop, intervalMs: 1000 })
    await flush()
    expect(fetchStatus).toHaveBeenCalledWith('WMT')
    expect(onLoop).toHaveBeenLastCalledWith(true)
    vi.advanceTimersByTime(1000)
    await flush()
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    stop()
  })

  it('조회에 실패하면 값을 바꾸지 않는다(마지막 값 유지)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const fetchStatus = vi.fn().mockResolvedValueOnce({ loop: true }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'))
    const onLoop = vi.fn()
    const stop = startLoopPolling({ ticker: 'WMT', fetchStatus, onLoop, intervalMs: 1000 })
    await flush()
    vi.advanceTimersByTime(1000)
    await flush()
    vi.advanceTimersByTime(1000)
    await flush()
    expect(onLoop).toHaveBeenCalledTimes(1)
    expect(onLoop).toHaveBeenCalledWith(true)
    stop()
  })

  it('멈춘 뒤 도착한 응답은 버리고 더 묻지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let resolve: (v: unknown) => void = () => {}
    const fetchStatus = vi.fn().mockReturnValue(new Promise((r) => { resolve = r }))
    const onLoop = vi.fn()
    const stop = startLoopPolling({ ticker: 'WMT', fetchStatus, onLoop, intervalMs: 1000 })
    stop()
    resolve({ loop: true })
    await flush()
    vi.advanceTimersByTime(5000)
    expect(onLoop).not.toHaveBeenCalled()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })
})
