import { describe, expect, it, vi } from 'vitest'
import { createStompBridge, STOMP_AUTH_ERROR, type StompClientConfig, type StompClientLike, type WsStatus } from './stomp'
import type { AuthProvider } from './auth'

class FakeClient implements StompClientLike {
  connected = false
  activated = 0
  deactivated = 0
  readonly subs: Array<{ destination: string; callback: (m: { body: string }) => void; unsubscribed: boolean }> = []
  constructor(readonly config: StompClientConfig) {}
  activate() {
    this.activated++
  }
  deactivate() {
    this.deactivated++
    this.connected = false
  }
  subscribe(destination: string, callback: (m: { body: string }) => void) {
    const sub = { destination, callback, unsubscribed: false }
    this.subs.push(sub)
    return { unsubscribe: () => void (sub.unsubscribed = true) }
  }
  /** 서버가 CONNECTED 를 돌려준 것처럼 한다. */
  open() {
    this.connected = true
    this.config.onConnect()
  }
  /** 소켓이 닫힌 것처럼 한다. 실제 라이브러리도 닫히면 connected 가 false 다. */
  close() {
    this.connected = false
    this.config.onWebSocketClose()
  }
  deliver(destination: string, body: string) {
    for (const sub of this.subs) if (sub.destination === destination && !sub.unsubscribed) sub.callback({ body })
  }
  active(destination: string) {
    return this.subs.filter((s) => s.destination === destination && !s.unsubscribed).length
  }
}

function setup(auth: Partial<AuthProvider> = {}) {
  const clients: FakeClient[] = []
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  const provider: AuthProvider = {
    getAccessToken: auth.getAccessToken ?? (async () => 'tok'),
    refresh: auth.refresh ?? (async () => null),
  }
  const bridge = createStompBridge({
    url: 'ws://backend/ws-native',
    auth: provider,
    createClient: (config) => {
      const client = new FakeClient(config)
      clients.push(client)
      return client
    },
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => void ((handle as { cleared: boolean }).cleared = true),
  })
  const statuses: WsStatus[] = []
  bridge.onStatus((s) => statuses.push(s))
  const pending = () => timers.filter((t) => !t.cleared)
  /** 예약된 재연결 타이머를 하나 실행한다. */
  const fire = async () => {
    const timer = pending()[0]
    timer.cleared = true
    timer.fn()
    await flush()
  }
  return { bridge, clients, timers, pending, fire, statuses, provider }
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createStompBridge', () => {
  it('토큰을 CONNECT 헤더용으로 넘기고, 연결 전에 받은 구독을 연결되면 건다', async () => {
    const { bridge, clients, statuses } = setup()
    const handler = vi.fn()
    bridge.subscribe('/topic/transcript/WMT', handler)
    await bridge.connect()

    expect(clients).toHaveLength(1)
    expect(clients[0].config).toMatchObject({ url: 'ws://backend/ws-native', token: 'tok' })
    expect(clients[0].activated).toBe(1)
    expect(clients[0].active('/topic/transcript/WMT')).toBe(0)

    clients[0].open()
    clients[0].deliver('/topic/transcript/WMT', '{"a":1}')
    expect(handler).toHaveBeenCalledWith('{"a":1}')
    expect(statuses).toEqual(['CONNECTING', 'CONNECTED'])
  })

  it('연결된 뒤 구독하면 바로 걸고, 같은 토픽을 다시 구독해도 한 번만 건다', async () => {
    const { bridge, clients } = setup()
    await bridge.connect()
    clients[0].open()
    const first = vi.fn()
    const second = vi.fn()
    bridge.subscribe('/topic/factcheck/WMT', first)
    bridge.subscribe('/topic/factcheck/WMT', second)
    expect(clients[0].active('/topic/factcheck/WMT')).toBe(1)

    clients[0].deliver('/topic/factcheck/WMT', 'x')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('x')
  })

  it('구독 해제하면 끊고, 재연결 때 다시 걸지 않는다', async () => {
    const { bridge, clients, fire } = setup()
    bridge.subscribe('/topic/evaluation/WMT', vi.fn())
    await bridge.connect()
    clients[0].open()
    bridge.unsubscribe('/topic/evaluation/WMT')
    expect(clients[0].active('/topic/evaluation/WMT')).toBe(0)

    clients[0].close()
    await fire()
    clients[1].open()
    expect(clients[1].subs).toHaveLength(0)
  })

  it('토큰이 없으면 client 를 만들지 않는다', async () => {
    const { bridge, clients, statuses } = setup({ getAccessToken: async () => null })
    await bridge.connect()
    expect(clients).toHaveLength(0)
    expect(statuses).toEqual([])
    expect(bridge.status).toBe('DISCONNECTED')
  })

  it('토큰을 기다리는 사이 connect 가 여러 번 불려도 client 는 하나', async () => {
    const { bridge, clients } = setup()
    await Promise.all([bridge.connect(), bridge.connect(), bridge.connect()])
    expect(clients).toHaveLength(1)
  })

  it('소켓이 닫히면 재연결하고 구독을 모두 다시 건다', async () => {
    const { bridge, clients, fire, pending } = setup()
    bridge.subscribe('/topic/transcript/WMT', vi.fn())
    bridge.subscribe('/topic/transcript-translation/WMT', vi.fn())
    await bridge.connect()
    clients[0].open()

    clients[0].close()
    expect(pending()).toHaveLength(1)
    expect(pending()[0].ms).toBe(2000)
    await fire()
    expect(clients).toHaveLength(2)
    clients[1].open()
    expect(clients[1].subs.map((s) => s.destination)).toEqual(['/topic/transcript/WMT', '/topic/transcript-translation/WMT'])
  })

  it('한 장애에 오류 콜백이 연달아 와도 재연결 타이머는 하나', async () => {
    const { bridge, clients, pending } = setup()
    await bridge.connect()
    clients[0].open()
    clients[0].config.onWebSocketError()
    clients[0].close()
    clients[0].config.onDisconnect()
    expect(pending()).toHaveLength(1)
  })

  it('실패가 이어지면 대기 시간을 늘리고, 연결되면 처음으로 되돌린다', async () => {
    const { bridge, clients, fire, pending } = setup()
    await bridge.connect()
    const delays: number[] = []
    for (let i = 0; i < 6; i++) {
      clients[clients.length - 1].close()
      delays.push(pending()[0].ms)
      await fire()
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000])

    clients[clients.length - 1].open()
    clients[clients.length - 1].close()
    expect(pending()[0].ms).toBe(2000)
  })

  it('교체된 옛 client 의 콜백은 무시한다', async () => {
    const { bridge, clients, fire, pending, statuses } = setup()
    await bridge.connect()
    clients[0].close()
    await fire()
    clients[1].open()
    const before = statuses.length

    clients[0].close()
    clients[0].config.onConnect()
    expect(statuses.length).toBe(before)
    expect(pending()).toHaveLength(0)
    expect(clients[0].deactivated).toBe(1)
  })

  it('인증 실패면 토큰을 한 번 갱신해 바로 다시 붙는다', async () => {
    let token = 'old'
    const refresh = vi.fn(async () => {
      token = 'new'
      return token
    })
    const s = setup({ refresh, getAccessToken: async () => token })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    // 거부된 토큰(연결에 쓴 것)을 알린다
    expect(refresh).toHaveBeenCalledWith('old')
    expect(s.clients).toHaveLength(2)
    expect(s.clients[1].config.token).toBe('new')
    expect(s.pending()).toHaveLength(0)
  })

  it('갱신한 토큰도 거부되면 다시 갱신하지 않고 백오프로 넘어간다', async () => {
    const refresh = vi.fn(async () => 'new')
    const s = setup({ refresh })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    s.clients[1].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(s.pending()).toHaveLength(1)
  })

  it('갱신할 수 없으면 다시 붙지 않고 끊긴 상태로 둔다', async () => {
    const s = setup({ refresh: async () => null })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(s.clients).toHaveLength(1)
    expect(s.pending()).toHaveLength(0)
    expect(s.bridge.status).toBe('DISCONNECTED')
  })

  it('인증 외의 STOMP 오류는 갱신 없이 백오프', async () => {
    const refresh = vi.fn(async () => 'new')
    const s = setup({ refresh })
    await s.bridge.connect()
    s.clients[0].config.onStompError('다른 오류')
    expect(refresh).not.toHaveBeenCalled()
    expect(s.pending()).toHaveLength(1)
  })

  it('disconnect 는 예약된 재연결을 취소하고 구독 목록을 비운다', async () => {
    const s = setup()
    s.bridge.subscribe('/topic/transcript/WMT', vi.fn())
    await s.bridge.connect()
    s.clients[0].close()
    s.bridge.disconnect()
    expect(s.pending()).toHaveLength(0)
    expect(s.bridge.status).toBe('DISCONNECTED')

    await s.bridge.connect()
    s.clients[1].open()
    expect(s.clients[1].subs).toHaveLength(0)
  })

  it('토큰을 기다리는 사이 disconnect 되면 client 를 만들지 않는다', async () => {
    let release: (token: string) => void = () => undefined
    const s = setup({ getAccessToken: () => new Promise<string>((resolve) => (release = resolve)) })
    const connecting = s.bridge.connect()
    s.bridge.disconnect()
    release('tok')
    await connecting
    expect(s.clients).toHaveLength(0)
  })

  it('ERROR 프레임 뒤에 소켓이 닫혀도, 갱신할 수 없으면 다시 붙지 않는다', async () => {
    const s = setup({ refresh: async () => null })
    await s.bridge.connect()
    s.clients[0].open()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    s.clients[0].close()
    await flush()
    expect(s.pending()).toHaveLength(0)
    expect(s.clients).toHaveLength(1)
    expect(s.bridge.status).toBe('DISCONNECTED')

    // 이후 구독이 connect 를 불러도 만료된 토큰으로 다시 두드리지 않는다
    await s.bridge.connect()
    await s.bridge.reconnectNow()
    expect(s.clients).toHaveLength(1)
  })

  it('갱신 요청이 실패(reject)하면 일시 장애로 보고 백오프하고, 다음 인증 실패에서 다시 갱신한다', async () => {
    const refresh = vi.fn(async (): Promise<string | null> => {
      throw new Error('network')
    })
    const s = setup({ refresh })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(s.pending()).toHaveLength(1)
    expect(s.bridge.status).toBe('RECONNECTING')

    refresh.mockImplementation(async () => 'new')
    await s.fire()
    s.clients[1].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(s.clients).toHaveLength(3)
  })

  it('연결에 성공하면 다음 인증 실패에서 다시 갱신한다', async () => {
    const refresh = vi.fn(async () => 'new')
    const s = setup({ refresh })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    s.clients[1].open()
    s.clients[1].config.onStompError(STOMP_AUTH_ERROR)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(s.pending()).toHaveLength(0)
  })

  it('갱신을 기다리는 사이 들어온 connect 는 갱신을 기다리고, 옛 토큰으로 따로 붙지 않는다', async () => {
    let release: (token: string) => void = () => undefined
    const s = setup({ refresh: () => new Promise<string>((resolve) => (release = resolve)) })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    const waiting = s.bridge.connect()
    expect(s.clients).toHaveLength(1)
    release('new')
    await waiting
    expect(s.clients).toHaveLength(2)
  })

  it('갱신을 기다리는 사이 disconnect 되면 다시 붙지 않는다', async () => {
    let release: (token: string) => void = () => undefined
    const s = setup({ refresh: () => new Promise<string>((resolve) => (release = resolve)) })
    await s.bridge.connect()
    s.clients[0].config.onStompError(STOMP_AUTH_ERROR)
    s.bridge.disconnect()
    release('new')
    await flush()
    expect(s.clients).toHaveLength(1)
    expect(s.bridge.status).toBe('DISCONNECTED')
  })

  it('연결 중(CONNECTED 전)에 connect 가 다시 불려도 진행 중인 시도를 끊지 않는다', async () => {
    const s = setup()
    await s.bridge.connect()
    expect(s.bridge.status).toBe('CONNECTING')
    await s.bridge.connect()
    expect(s.clients).toHaveLength(1)
    expect(s.clients[0].deactivated).toBe(0)
  })

  it('소켓 오류 뒤 닫힘이 와도 재연결 대기 상태를 유지한다', async () => {
    const s = setup()
    await s.bridge.connect()
    s.clients[0].open()
    s.clients[0].config.onWebSocketError()
    s.clients[0].close()
    expect(s.bridge.status).toBe('RECONNECTING')
    expect(s.pending()).toHaveLength(1)
  })

  it('토큰 조회가 실패(reject)하면 백오프한다', async () => {
    const s = setup({
      getAccessToken: async () => {
        throw new Error('발급 실패')
      },
    })
    await s.bridge.connect()
    expect(s.clients).toHaveLength(0)
    expect(s.pending()).toHaveLength(1)
    expect(s.bridge.status).toBe('RECONNECTING')
  })

  it('reconnectNow 는 연결돼 있어도 버리고 새로 붙어 구독을 다시 건다', async () => {
    const s = setup()
    s.bridge.subscribe('/topic/transcript/WMT', vi.fn())
    await s.bridge.connect()
    s.clients[0].open()
    await s.bridge.reconnectNow()
    expect(s.clients[0].deactivated).toBe(1)
    expect(s.clients).toHaveLength(2)
    s.clients[1].open()
    expect(s.clients[1].active('/topic/transcript/WMT')).toBe(1)

    // 떼어 낸 옛 client 의 뒤늦은 닫힘은 무시한다
    s.clients[0].close()
    expect(s.pending()).toHaveLength(0)
    expect(s.bridge.status).toBe('CONNECTED')
  })

  it('reconnectNow 는 예약된 재연결을 앞당기고 대기 시간을 처음으로 되돌린다', async () => {
    const s = setup()
    await s.bridge.connect()
    s.clients[0].close()
    expect(s.pending()).toHaveLength(1)
    await s.bridge.reconnectNow()
    expect(s.pending()).toHaveLength(0)
    expect(s.clients).toHaveLength(2)
    s.clients[1].close()
    expect(s.pending()[0].ms).toBe(2000)
  })

  it('disconnect 뒤에는 reconnectNow 가 아무것도 하지 않는다', async () => {
    const s = setup()
    await s.bridge.connect()
    s.bridge.disconnect()
    await s.bridge.reconnectNow()
    expect(s.clients).toHaveLength(1)
  })

  it('토큰을 기다리는 사이 끊었다가 다시 connect 하면 그 시도가 연결을 마친다', async () => {
    let release: (token: string) => void = () => undefined
    const s = setup({ getAccessToken: () => new Promise<string>((resolve) => (release = resolve)) })
    const first = s.bridge.connect()
    s.bridge.disconnect()
    const second = s.bridge.connect()
    release('tok')
    await Promise.all([first, second])
    expect(s.clients).toHaveLength(1)
  })
})
