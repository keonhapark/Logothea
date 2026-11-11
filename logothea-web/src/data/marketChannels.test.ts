import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { IpcError } from '@terminal/lib/types/ipcError'
import { createWebIpc } from './webIpc'
import { REFRESH_TIMELINE, TIMELINE_DAYS, TIMELINE_POLL_MS } from './marketChannels'
import type { StompBridge, WsStatus } from './stomp'

function setup(getJson: (path: string) => Promise<unknown> = async () => []) {
  const handlers = new Map<string, (body: string) => void>()
  const stomp = {
    status: 'DISCONNECTED' as WsStatus,
    connect: vi.fn(async () => undefined),
    reconnectNow: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    subscribe: vi.fn((destination: string, handler: (body: string) => void) => void handlers.set(destination, handler)),
    unsubscribe: vi.fn((destination: string) => void handlers.delete(destination)),
    onStatus: vi.fn(() => () => undefined),
  } satisfies StompBridge
  const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  let clock = 0
  const http = { getJson: vi.fn(getJson) }
  const ipc = createWebIpc({
    http: http as never,
    stomp,
    assistant: { ask: vi.fn(), cancel: vi.fn() },
    timers: {
      setInterval: (fn, ms) => {
        const timer = { fn, ms, cleared: false }
        intervals.push(timer)
        return timer
      },
      clearInterval: (handle) => void ((handle as { cleared: boolean }).cleared = true),
      now: () => clock,
    },
  })
  return { ipc, http, stomp, handlers, intervals, advance: (ms: number) => (clock += ms) }
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** 지금부터 10분 뒤 시작하는 콜 — live 로 묶인다. */
function liveItem() {
  return { ticker: 'WMT', companyName: 'Walmart', scheduledAt: Math.floor(Date.now() / 1000) + 600, confirmed: true, marketSession: 'bmo' }
}

describe('어닝콜 일정', () => {
  it('백엔드 목록을 터미널과 같은 groupEarnings 로 묶어 돌려준다', async () => {
    const { ipc, http } = setup(async () => [liveItem()])
    const data = await ipc.invoke<{ live: { ticker: string } | null }>(IPC_CHANNELS.EARNINGS_TIMELINE_GET)
    expect(http.getJson).toHaveBeenCalledWith(`/api/v1/earnings-calendar/terminal-timeline?days=${TIMELINE_DAYS}`)
    expect(data.live?.ticker).toBe('WMT')
  })

  it('실패해도 reject 하지 않고 빈 일정', async () => {
    const { ipc } = setup(async () => {
      throw new IpcError('BACKEND_5XX', 'x')
    })
    await expect(ipc.invoke(IPC_CHANNELS.EARNINGS_TIMELINE_GET)).resolves.toEqual({ live: null, groups: [] })
  })

  it('UPDATE 를 듣는 동안에만 5분마다 다시 받아 민다', async () => {
    const { ipc, intervals } = setup(async () => [liveItem()])
    expect(intervals).toHaveLength(0)
    const listener = vi.fn()
    const off = ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, listener)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(TIMELINE_POLL_MS)

    intervals[0].fn()
    await flush()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ live: expect.objectContaining({ ticker: 'WMT' }) }))

    off()
    expect(intervals[0].cleared).toBe(true)
  })

  it('폴링이 실패하면 아무것도 보내지 않아 받아 둔 일정을 지우지 않는다', async () => {
    const { ipc, intervals } = setup(async () => {
      throw new IpcError('NETWORK', 'x')
    })
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, listener)
    intervals[0].fn()
    await flush()
    expect(listener).not.toHaveBeenCalled()
  })

  it('다시 받기 채널은 일정을 지금 받아 UPDATE 로 민다(연결이 되살아났을 때)', async () => {
    const { ipc } = setup(async () => [liveItem()])
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, listener)
    await ipc.invoke(REFRESH_TIMELINE)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ live: expect.objectContaining({ ticker: 'WMT' }) }))
  })

  it('리스너가 여럿이어도 폴링은 하나이고, 마지막 리스너가 떠날 때 멈춘다', () => {
    const { ipc, intervals } = setup()
    const offA = ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, vi.fn())
    const offB = ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, vi.fn())
    expect(intervals).toHaveLength(1)
    offA()
    offA()
    expect(intervals[0].cleared).toBe(false)
    offB()
    expect(intervals[0].cleared).toBe(true)

    ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, vi.fn())
    expect(intervals).toHaveLength(2)
  })
})

describe('시장 지수', () => {
  it('스냅샷을 받고, 실패는 빈 배열, AUTH_EXPIRED 만 던진다', async () => {
    const ok = setup(async () => [{ symbol: 'SPX' }])
    await expect(ok.ipc.invoke(IPC_CHANNELS.MARKET_INDICES_GET)).resolves.toEqual([{ symbol: 'SPX' }])
    expect(ok.http.getJson).toHaveBeenCalledWith('/api/v1/market/indices')

    const failing = setup(async () => {
      throw new IpcError('NETWORK', 'x')
    })
    await expect(failing.ipc.invoke(IPC_CHANNELS.MARKET_INDICES_GET)).resolves.toEqual([])

    const expired = setup(async () => {
      throw new IpcError('AUTH_EXPIRED', 'x')
    })
    await expect(expired.ipc.invoke(IPC_CHANNELS.MARKET_INDICES_GET)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
  })

  it('UPDATE 를 듣는 동안에만 /topic/market/indices 를 구독한다', () => {
    const { ipc, stomp, handlers } = setup()
    const listener = vi.fn()
    const off = ipc.on(IPC_CHANNELS.MARKET_INDICES_UPDATE, listener)
    expect(stomp.subscribe).toHaveBeenCalledWith('/topic/market/indices', expect.any(Function))
    expect(stomp.connect).toHaveBeenCalled()

    handlers.get('/topic/market/indices')!('{"symbol":"SPX","price":1}')
    expect(listener).toHaveBeenCalledWith({ symbol: 'SPX', price: 1 })

    off()
    expect(stomp.unsubscribe).toHaveBeenCalledWith('/topic/market/indices')
  })
})

describe('종목 목록 · 시세', () => {
  it('S&P 500 목록은 5분 캐시하고, 캐시가 있으면 실패해도 캐시를 준다', async () => {
    let fail = false
    const { ipc, http, advance } = setup(async () => {
      if (fail) throw new IpcError('BACKEND_5XX', 'x')
      return [{ ticker: 'WMT' }]
    })
    await ipc.invoke(IPC_CHANNELS.STOCKS_SP500_GET)
    await ipc.invoke(IPC_CHANNELS.STOCKS_SP500_GET)
    expect(http.getJson).toHaveBeenCalledTimes(1)

    advance(5 * 60 * 1000)
    fail = true
    await expect(ipc.invoke(IPC_CHANNELS.STOCKS_SP500_GET)).resolves.toEqual([{ ticker: 'WMT' }])
    expect(http.getJson).toHaveBeenCalledTimes(2)
  })

  it('S&P 500 목록을 한 번도 못 받았으면 실패를 알린다', async () => {
    const { ipc } = setup(async () => {
      throw new IpcError('BACKEND_5XX', 'x')
    })
    await expect(ipc.invoke(IPC_CHANNELS.STOCKS_SP500_GET)).rejects.toMatchObject({ code: 'BACKEND_5XX' })
  })

  it('PRICES_GET 은 스냅샷을 터미널 시세 캐시 모양으로 바꾼다', async () => {
    const { ipc, http } = setup(async () => [
      { ticker: 'WMT', currentPrice: 100, previousClose: 98, changePercent: 2, updatedAt: 1700 },
      { ticker: 'BAD' },
    ])
    await expect(ipc.invoke(IPC_CHANNELS.PRICES_GET)).resolves.toEqual({
      WMT: { currentPrice: 100, previousClose: 98, lastUpdated: 1700 },
    })
    expect(http.getJson).toHaveBeenCalledWith('/api/v1/stocks/prices')
  })

  it('스냅샷 목록 실패는 빈 배열이지만, PRICES_GET 은 reject 해 이미 보이던 시세를 지우지 않는다', async () => {
    const { ipc } = setup(async () => {
      throw new IpcError('NETWORK', 'x')
    })
    await expect(ipc.invoke(IPC_CHANNELS.STOCK_PRICES_SNAPSHOT_GET)).resolves.toEqual([])
    await expect(ipc.invoke(IPC_CHANNELS.PRICES_GET)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('PRICES_GET 은 스냅샷보다 새 실시간 값을 우선한다', async () => {
    const { ipc, handlers } = setup(async () => [
      { ticker: 'WMT', currentPrice: 100, previousClose: 98, changePercent: 2, updatedAt: 1000 },
      { ticker: 'AAPL', currentPrice: 200, previousClose: 199, changePercent: 1, updatedAt: 3000 },
    ])
    ipc.on(IPC_CHANNELS.PRICES_UPDATE, vi.fn())
    handlers.get('/topic/prices')!(
      '[{"ticker":"WMT","currentPrice":101,"previousClose":98,"updatedAt":2000},{"ticker":"AAPL","currentPrice":190,"previousClose":199,"updatedAt":2000},{"ticker":"MSFT","currentPrice":300,"previousClose":299,"updatedAt":2000}]',
    )
    await expect(ipc.invoke(IPC_CHANNELS.PRICES_GET)).resolves.toEqual({
      WMT: { currentPrice: 101, previousClose: 98, lastUpdated: 2000 },
      AAPL: { currentPrice: 200, previousClose: 199, lastUpdated: 3000 },
      MSFT: { currentPrice: 300, previousClose: 299, lastUpdated: 2000 },
    })
  })

  it('PRICES_UPDATE 는 /topic/prices 를 StompService 와 같은 모양으로 바꿔 민다', () => {
    const { ipc, handlers, stomp } = setup()
    const listener = vi.fn()
    const off = ipc.on(IPC_CHANNELS.PRICES_UPDATE, listener)
    const deliver = handlers.get('/topic/prices')!
    deliver('[]')
    deliver('[{"ticker":"WMT","currentPrice":100,"previousClose":98,"changePercent":2,"updatedAt":1700}]')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([{ ticker: 'WMT', currentPrice: 100, previousClose: 98, lastUpdated: 1700 }])
    off()
    expect(stomp.unsubscribe).toHaveBeenCalledWith('/topic/prices')
  })
})

describe('종목 상세', () => {
  it('종목 기호를 검증하고 30초 캐시한다', async () => {
    const { ipc, http, advance } = setup(async () => ({ ticker: 'WMT', partial: false }))
    await expect(ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'wmt' })).rejects.toMatchObject({ code: 'VALIDATION' })

    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    advance(29_999)
    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    expect(http.getJson).toHaveBeenCalledTimes(1)
    expect(http.getJson).toHaveBeenCalledWith('/api/v1/stocks/WMT/detail')

    advance(1)
    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    expect(http.getJson).toHaveBeenCalledTimes(2)
  })

  it('부분 응답은 5초만 캐시한다', async () => {
    const { ipc, http, advance } = setup(async () => ({ ticker: 'WMT', partial: true }))
    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    advance(5_000)
    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    expect(http.getJson).toHaveBeenCalledTimes(2)
  })

  it('실패는 그대로 던지고 캐시하지 않는다', async () => {
    let fail = true
    const { ipc, http } = setup(async () => {
      if (fail) throw new IpcError('BACKEND_5XX', 'x')
      return { ticker: 'WMT', partial: false }
    })
    await expect(ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })).rejects.toMatchObject({ code: 'BACKEND_5XX' })
    fail = false
    await ipc.invoke(IPC_CHANNELS.STOCK_GET_DETAIL, { ticker: 'WMT' })
    expect(http.getJson).toHaveBeenCalledTimes(2)
  })
})

describe('push 채널 생명주기', () => {
  it('WS_DISCONNECT 뒤 WS_CONNECT 하면 듣고 있던 지수 · 시세 토픽을 다시 구독한다', async () => {
    const { ipc, stomp } = setup()
    ipc.on(IPC_CHANNELS.PRICES_UPDATE, vi.fn())
    ipc.on(IPC_CHANNELS.MARKET_INDICES_UPDATE, vi.fn())
    await ipc.invoke(IPC_CHANNELS.WS_DISCONNECT)
    stomp.subscribe.mockClear()
    await ipc.invoke(IPC_CHANNELS.WS_CONNECT)
    expect(stomp.subscribe.mock.calls.map((c) => c[0]).sort()).toEqual(['/topic/market/indices', '/topic/prices'])
  })

  it('끊지 않았으면 WS_CONNECT 가 구독을 건드리지 않는다', async () => {
    const { ipc, stomp } = setup()
    ipc.on(IPC_CHANNELS.PRICES_UPDATE, vi.fn())
    stomp.subscribe.mockClear()
    await ipc.invoke(IPC_CHANNELS.WS_CONNECT)
    expect(stomp.subscribe).not.toHaveBeenCalled()
    expect(stomp.unsubscribe).not.toHaveBeenCalled()
  })

  it('같은 리스너 함수를 두 번 등록하면 따로 세어, 하나를 떼도 구독이 유지된다', () => {
    const { ipc, stomp, handlers } = setup()
    const listener = vi.fn()
    const offA = ipc.on(IPC_CHANNELS.PRICES_UPDATE, listener)
    ipc.on(IPC_CHANNELS.PRICES_UPDATE, listener)
    offA()
    expect(stomp.unsubscribe).not.toHaveBeenCalled()
    handlers.get('/topic/prices')!('[{"ticker":"WMT","currentPrice":1,"previousClose":1,"updatedAt":1}]')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
