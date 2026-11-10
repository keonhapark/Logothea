import { describe, expect, it, vi } from 'vitest'
import { COOLDOWN_JITTER, COOLDOWN_MS, createGuestTokenProvider, GuestTokenError, RENEW_BEFORE_MS, type GuestStatus } from './auth'
import { briefErrorMessage } from '../screens/Brief'
import { GUEST_NOTICE } from '../components/ServerNotice'
import { IpcError } from '@terminal/lib/types/ipcError'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(responses: Array<Response | Error>, random = () => 0.5) {
  let clock = 1_000_000
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('응답 없음')
    if (next instanceof Error) throw next
    return next
  })
  // random 0.5 → 흩뜨림 없이 기본 대기 시간 그대로
  const provider = createGuestTokenProvider({ baseUrl: 'http://backend', fetch: fetch as unknown as typeof globalThis.fetch, now: () => clock, random })
  const statuses: GuestStatus[] = []
  provider.onStatus((s) => statuses.push(s))
  return { provider, fetch, statuses, advance: (ms: number) => (clock += ms) }
}

describe('createGuestTokenProvider', () => {
  it('본문 · 쿠키 없이 POST 로 받고, 만료 1분 전까지는 다시 묻지 않는다', async () => {
    const { provider, fetch, advance, statuses } = setup([json(200, { access_token: 't1', expires_in: 3600 }), json(200, { access_token: 't2', expires_in: 3600 })])
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://backend/api/v1/guest/token')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' })
    expect(init.body).toBeUndefined()

    advance(3600_000 - RENEW_BEFORE_MS - 1)
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    advance(1)
    await expect(provider.getAccessToken()).resolves.toBe('t2')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(statuses).toEqual(['ready'])
  })

  it('동시에 여러 번 불러도 한 번만 발급받는다', async () => {
    const { provider, fetch } = setup([json(200, { access_token: 't1', expires_in: 3600 })])
    const all = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.refresh()])
    expect(all).toEqual(['t1', 't1', 't1'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refresh 는 받아 둔 토큰을 버리고 새로 받는다(서버가 거부했을 때)', async () => {
    const { provider } = setup([json(200, { access_token: 't1', expires_in: 3600 }), json(200, { access_token: 't2', expires_in: 3600 })])
    await provider.getAccessToken()
    await expect(provider.refresh()).resolves.toBe('t2')
  })

  it('404(서버에서 꺼짐)면 null 을 돌려주고 다시 묻지 않는다', async () => {
    const { provider, fetch, advance } = setup([json(404)])
    await expect(provider.getAccessToken()).resolves.toBeNull()
    expect(provider.status).toBe('disabled')
    advance(60 * 60_000)
    await expect(provider.getAccessToken()).resolves.toBeNull()
    await expect(provider.refresh()).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [json(429, { error: 'x', code: 'guest_rate_limited' }), 'rate_limited'],
    [json(503, { error: 'x', code: 'guest_unavailable' }), 'unavailable'],
    [new TypeError('Failed to fetch'), 'unavailable'],
    [json(200, { access_token: '', expires_in: 3600 }), 'unavailable'],
    [json(200, { access_token: 't' }), 'unavailable'],
    [json(200, { access_token: 't', expires_in: '3600' }), 'unavailable'],
    [new Response('not json', { status: 200 }), 'unavailable'],
  ] as const)('일시 장애는 reject 하고 대기 시간 동안 다시 묻지 않는다: %s', async (response, status) => {
    const { provider, fetch, advance } = setup([response, json(200, { access_token: 't1', expires_in: 3600 })])
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
    expect(provider.status).toBe(status)

    await expect(provider.getAccessToken()).rejects.toMatchObject({ status })
    expect(fetch).toHaveBeenCalledTimes(1)

    advance(COOLDOWN_MS[status])
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    expect(provider.status).toBe('ready')
  })

  it('미리 새로 받으려다 일시 장애면 아직 유효한 토큰을 그대로 쓰고 안내를 띄우지 않는다', async () => {
    const { provider, advance, fetch } = setup([json(200, { access_token: 't1', expires_in: 3600 }), json(429, { code: 'guest_rate_limited' })])
    await provider.getAccessToken()
    advance(3600_000 - 30_000)
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    expect(provider.status).toBe('ready')
    // 대기 시간 안에는 다시 묻지 않는다
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    expect(fetch).toHaveBeenCalledTimes(2)
    // 정말 만료되면 실패를 알린다
    advance(30_000)
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
  })
})

describe('refresh — 일시 장애', () => {
  it('서버가 토큰을 거부한 뒤 재발급이 일시 장애면 reject 한다(null 이면 STOMP 가 영구히 멈춘다)', async () => {
    const { provider, fetch } = setup([json(200, { access_token: 't1', expires_in: 3600 }), json(429, { code: 'guest_rate_limited' })])
    await provider.getAccessToken()
    await expect(provider.refresh()).rejects.toMatchObject({ status: 'rate_limited' })
    // 대기 시간 안에는 서버에 묻지 않고 바로 reject
    await expect(provider.refresh()).rejects.toBeInstanceOf(GuestTokenError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('게스트 토큰 × STOMP (실제 두 모듈)', () => {
  async function wire(responses: Array<Response | Error>) {
    const { createStompBridge, STOMP_AUTH_ERROR } = await import('./stomp')
    const { provider } = setup(responses)
    const clients: { config: { onStompError: (m?: string) => void; token: string } }[] = []
    const timers: { ms: number }[] = []
    const bridge = createStompBridge({
      url: 'ws://x',
      auth: provider,
      createClient: (config) => {
        clients.push({ config })
        return { connected: false, activate() {}, deactivate() {}, subscribe: () => ({ unsubscribe() {} }) }
      },
      setTimer: (_fn, ms) => {
        const t = { ms }
        timers.push(t)
        return t
      },
      clearTimer: () => undefined,
    })
    return { bridge, clients, timers, STOMP_AUTH_ERROR }
  }
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  it('발급이 429 면 연결하지 않고 백오프로 다시 시도한다', async () => {
    const { bridge, clients, timers } = await wire([json(429, { code: 'guest_rate_limited' })])
    await bridge.connect()
    expect(clients).toHaveLength(0)
    expect(bridge.status).toBe('RECONNECTING')
    expect(timers).toHaveLength(1)
  })

  it('발급이 404(꺼짐)면 연결하지 않고 멈춘다', async () => {
    const { bridge, clients, timers } = await wire([json(404)])
    await bridge.connect()
    expect(clients).toHaveLength(0)
    expect(bridge.status).toBe('DISCONNECTED')
    expect(timers).toHaveLength(0)
  })

  it('붙은 뒤 인증 실패 + 재발급 429 면 백오프, 404 면 멈춘다', async () => {
    const rate = await wire([json(200, { access_token: 't1', expires_in: 3600 }), json(429, { code: 'guest_rate_limited' })])
    await rate.bridge.connect()
    rate.clients[0].config.onStompError(rate.STOMP_AUTH_ERROR)
    await flush()
    expect(rate.bridge.status).toBe('RECONNECTING')
    expect(rate.timers).toHaveLength(1)

    const off = await wire([json(200, { access_token: 't1', expires_in: 3600 }), json(404)])
    await off.bridge.connect()
    off.clients[0].config.onStompError(off.STOMP_AUTH_ERROR)
    await flush()
    expect(off.bridge.status).toBe('DISCONNECTED')
    expect(off.timers).toHaveLength(0)
  })
})

describe('발급 한도를 아끼는 규칙', () => {
  it('같은 토큰으로 401 을 받은 요청이 여럿이어도 한 번만 새로 받는다', async () => {
    const { provider, fetch } = setup([json(200, { access_token: 't1', expires_in: 3600 }), json(200, { access_token: 't2', expires_in: 3600 })])
    await provider.getAccessToken()
    await expect(provider.refresh('t1')).resolves.toBe('t2')
    // 늦게 도착한 401 들: 거부된 것은 t1 이고 이미 t2 가 있다
    await expect(provider.refresh('t1')).resolves.toBe('t2')
    await expect(provider.refresh('t1')).resolves.toBe('t2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('거부된 토큰은 미리 갱신이 실패해도 되살리지 않는다', async () => {
    let release: (r: Response) => void = () => undefined
    const responses: Array<Response | Error> = [json(200, { access_token: 't1', expires_in: 3600 })]
    const { provider, advance, fetch } = setup(responses)
    await provider.getAccessToken()
    advance(3600_000 - 30_000)
    fetch.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
    const early = provider.getAccessToken()
    const rejected = provider.refresh('t1')
    release(json(429, { code: 'guest_rate_limited' }))
    await expect(rejected).rejects.toBeInstanceOf(GuestTokenError)
    await expect(early).rejects.toBeInstanceOf(GuestTokenError)
    expect(provider.status).toBe('rate_limited')
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
  })

  it('대기 시간을 ±30% 흩뜨리고, 429 의 Retry-After(초)를 따른다', async () => {
    const low = setup([json(503, { code: 'guest_unavailable' }), json(200, { access_token: 't', expires_in: 3600 })], () => 0)
    await low.provider.getAccessToken().catch(() => undefined)
    low.advance(COOLDOWN_MS.unavailable * (1 - COOLDOWN_JITTER) - 1)
    await expect(low.provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
    low.advance(1)
    await expect(low.provider.getAccessToken()).resolves.toBe('t')

    const retryAfter = setup([new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }), json(200, { access_token: 't', expires_in: 3600 })])
    await retryAfter.provider.getAccessToken().catch(() => undefined)
    retryAfter.advance(4_999)
    await expect(retryAfter.provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
    retryAfter.advance(1)
    await expect(retryAfter.provider.getAccessToken()).resolves.toBe('t')
  })

  it('본문이 있는 404 는 꺼짐이 아니라 일시 장애로 본다(프록시 · 배포 중 경로 어긋남)', async () => {
    const { provider } = setup([new Response('<html>not found</html>', { status: 404 })])
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GuestTokenError)
    expect(provider.status).toBe('unavailable')
  })

  it('토큰 수명이 짧으면 미리 갱신 시점을 수명의 절반으로 줄인다(매 호출 발급하지 않는다)', async () => {
    const { provider, advance, fetch } = setup([json(200, { access_token: 't1', expires_in: 60 }), json(200, { access_token: 't2', expires_in: 60 })])
    await provider.getAccessToken()
    advance(29_999)
    await expect(provider.getAccessToken()).resolves.toBe('t1')
    expect(fetch).toHaveBeenCalledTimes(1)
    advance(1)
    await expect(provider.getAccessToken()).resolves.toBe('t2')
  })
})

describe('화면 문구', () => {
  it('브리핑: 404(전시 버전에서 볼 수 없는 종목)와 그 밖의 실패를 가른다', () => {
    expect(briefErrorMessage(new IpcError('VALIDATION', 'stock not available', { status: 404 }))).toBe('이 종목은 전시 버전에서 브리핑을 볼 수 없습니다.')
    // 다른 이유의 404 는 전시 버전 문구로 바꾸지 않는다
    expect(briefErrorMessage(new IpcError('VALIDATION', '요청이 잘못되었습니다.', { status: 404 }))).toContain('불러오지 못했습니다')
    expect(briefErrorMessage(new IpcError('AUTH_EXPIRED', 'x', { status: 401 }))).toContain('새로 고쳐 주세요')
    expect(briefErrorMessage(new IpcError('BACKEND_5XX', 'x', { status: 503 }))).toContain('불러오지 못했습니다')
    expect(briefErrorMessage(new Error('x'))).toContain('불러오지 못했습니다')
  })

  it('홈 연결 안내는 받지 못한 경우에만 문구가 있다', () => {
    expect(Object.keys(GUEST_NOTICE).sort()).toEqual(['disabled', 'rate_limited', 'unavailable'])
  })
})
