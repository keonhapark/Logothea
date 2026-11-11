import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { IpcError } from '@terminal/lib/types/ipcError'
import { createWebIpc } from './webIpc'
import type { StompBridge, WsStatus } from './stomp'
import type { AssistantStream } from './assistant'

function fakeStomp() {
  const handlers = new Map<string, (body: string) => void>()
  let statusListener: ((s: WsStatus) => void) | null = null
  const stomp = {
    status: 'DISCONNECTED' as WsStatus,
    connect: vi.fn(async () => undefined),
    reconnectNow: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    subscribe: vi.fn((destination: string, handler: (body: string) => void) => void handlers.set(destination, handler)),
    unsubscribe: vi.fn((destination: string) => void handlers.delete(destination)),
    onStatus: vi.fn((listener: (s: WsStatus) => void) => {
      statusListener = listener
      return () => undefined
    }),
  } satisfies StompBridge
  return { stomp, handlers, setStatus: (s: WsStatus) => statusListener?.(s) }
}

function setup(getJson: (path: string) => Promise<unknown> = async () => null) {
  const { stomp, handlers, setStatus } = fakeStomp()
  const assistant: AssistantStream = {
    ask: vi.fn(async (req) => ({ requestId: req.requestId })),
    cancel: vi.fn(() => true),
  }
  const http = { getJson: vi.fn(getJson) as never }
  const ipc = createWebIpc({ http, stomp, assistant })
  return { ipc, stomp, handlers, setStatus, assistant, http }
}

const askRequest = {
  requestId: 'r1', ticker: 'WMT', callId: 'call-1', asOfSequence: 3, anchorSequence: null,
  question: '요약', suggestedQuestionId: null, history: [],
}

describe('createWebIpc — STOMP 채널', () => {
  it.each([
    [IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, '/topic/transcript/WMT', IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED],
    [IPC_CHANNELS.FACTCHECK_SUBSCRIBE, '/topic/factcheck/WMT', IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED],
    [IPC_CHANNELS.TRANSCRIPT_DIFF_SUBSCRIBE, '/topic/transcript-diff/WMT', IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED],
    [IPC_CHANNELS.TRANSCRIPT_TRANSLATION_SUBSCRIBE, '/topic/transcript-translation/WMT', IPC_CHANNELS.TRANSCRIPT_TRANSLATION_RECEIVED],
    [IPC_CHANNELS.EVALUATION_SUBSCRIBE, '/topic/evaluation/WMT', IPC_CHANNELS.EVALUATION_RECEIVED],
  ])('%s → %s 를 구독하고 메시지를 파싱해 %s 로 낸다', async (channel, topic, received) => {
    const { ipc, stomp, handlers } = setup()
    const listener = vi.fn()
    ipc.on(received, listener)
    await ipc.invoke(channel, { ticker: 'WMT' })

    expect(stomp.subscribe).toHaveBeenCalledWith(topic, expect.any(Function))
    expect(stomp.connect).toHaveBeenCalled()
    handlers.get(topic)!('{"ticker":"WMT","sequence":1}')
    expect(listener).toHaveBeenCalledWith({ ticker: 'WMT', sequence: 1 })
  })

  it('UNSUBSCRIBE 는 같은 토픽을 해제한다', async () => {
    const { ipc, stomp } = setup()
    await ipc.invoke(IPC_CHANNELS.FACTCHECK_UNSUBSCRIBE, { ticker: 'WMT' })
    expect(stomp.unsubscribe).toHaveBeenCalledWith('/topic/factcheck/WMT')
  })

  it.each([undefined, null, {}, { ticker: 3 }, { ticker: '' }, { ticker: 'wmt' }, { ticker: 'WMT/../x' }, { ticker: 'TOOLONGTICKER' }])(
    '종목 기호가 아니면 구독하지 않는다: %j',
    async (payload) => {
      const { ipc, stomp } = setup()
      await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, payload)
      expect(stomp.subscribe).not.toHaveBeenCalled()
    },
  )

  it('JSON 이 아닌 메시지는 버리고 리스너를 부르지 않는다', async () => {
    const { ipc, handlers } = setup()
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, listener)
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    handlers.get('/topic/transcript/WMT')!('{깨짐')
    expect(listener).not.toHaveBeenCalled()
  })

  it('연결 상태를 WS_STATUS_CHANGED 로 낸다', () => {
    const { ipc, setStatus } = setup()
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.WS_STATUS_CHANGED, listener)
    setStatus('CONNECTED')
    expect(listener).toHaveBeenCalledWith({ status: 'CONNECTED' })
  })

  it('리스너 하나가 던져도 나머지는 받고, 해제한 리스너는 받지 않는다', async () => {
    const { ipc, handlers } = setup()
    const throwing = vi.fn(() => {
      throw new Error('x')
    })
    const kept = vi.fn()
    const removed = vi.fn()
    ipc.on(IPC_CHANNELS.EVALUATION_RECEIVED, throwing)
    ipc.on(IPC_CHANNELS.EVALUATION_RECEIVED, kept)
    ipc.on(IPC_CHANNELS.EVALUATION_RECEIVED, removed)()
    await ipc.invoke(IPC_CHANNELS.EVALUATION_SUBSCRIBE, { ticker: 'WMT' })
    handlers.get('/topic/evaluation/WMT')!('{}')
    expect(kept).toHaveBeenCalledTimes(1)
    expect(removed).not.toHaveBeenCalled()
  })
})

describe('createWebIpc — REST 채널', () => {
  it('용어 사전을 가져온다', async () => {
    const { ipc, http } = setup(async () => ({ version: 1, terms: [] }))
    await expect(ipc.invoke(IPC_CHANNELS.GLOSSARY_GET)).resolves.toEqual({ version: 1, terms: [] })
    expect(http.getJson).toHaveBeenCalledWith('/api/v1/glossary')
  })

  it('용어 사전 실패는 null, AUTH_EXPIRED 만 던진다', async () => {
    const failing = setup(async () => {
      throw new IpcError('BACKEND_5XX', 'x')
    })
    await expect(failing.ipc.invoke(IPC_CHANNELS.GLOSSARY_GET)).resolves.toBeNull()

    const expired = setup(async () => {
      throw new IpcError('AUTH_EXPIRED', 'x')
    })
    await expect(expired.ipc.invoke(IPC_CHANNELS.GLOSSARY_GET)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
  })

  it('화자 명부를 터미널과 같은 모양으로 바꾸고 실패하면 빈 배열', async () => {
    const { ipc } = setup(async () => [
      { name: 'John Furner', match_key: 'CEO · John Furner', title: 'CEO', affiliation: 'Walmart Inc.', analyst: false },
      { name: 'Kate McShane', match_key: '', title: 'Analyst', affiliation: 'Goldman Sachs', analyst: true },
      { name: 'kate mcshane' },
      { name: '  ' },
    ])
    await expect(ipc.invoke(IPC_CHANNELS.DEMO_EARNINGS_SPEAKERS)).resolves.toEqual([
      { matchKey: 'ceo · john furner', name: 'John Furner', title: 'CEO', affiliation: 'Walmart Inc.', kind: 'MANAGEMENT' },
      { matchKey: 'kate mcshane', name: 'Kate McShane', title: 'Analyst', affiliation: 'Goldman Sachs', kind: 'ANALYST' },
    ])

    const failing = setup(async () => {
      throw new IpcError('NETWORK', 'x')
    })
    await expect(failing.ipc.invoke(IPC_CHANNELS.DEMO_EARNINGS_SPEAKERS)).resolves.toEqual([])
  })
})

describe('createWebIpc — 질의응답', () => {
  it('질문을 스트림으로 넘기고 이벤트를 ASSISTANT_EVENT 로 낸다', async () => {
    const { ipc, assistant } = setup()
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.ASSISTANT_EVENT, listener)
    await expect(ipc.invoke(IPC_CHANNELS.ASSISTANT_ASK, askRequest)).resolves.toEqual({ requestId: 'r1' })

    const sink = vi.mocked(assistant.ask).mock.calls[0][1]
    sink({ requestId: 'r1', type: 'delta', data: { text: 'a' } })
    expect(listener).toHaveBeenCalledWith({ requestId: 'r1', type: 'delta', data: { text: 'a' } })
  })

  it.each([
    { question: '   ' },
    { question: 'x'.repeat(501) },
    { asOfSequence: -1 },
    { callId: '' },
    { history: new Array(7).fill({ role: 'user', text: 'a' }) },
    { history: [{ role: 'system', text: 'a' }] },
  ])('형식이 틀린 질문은 보내지 않고 VALIDATION: %j', async (override) => {
    const { ipc, assistant } = setup()
    await expect(ipc.invoke(IPC_CHANNELS.ASSISTANT_ASK, { ...askRequest, ...override })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(assistant.ask).not.toHaveBeenCalled()
  })

  it('취소는 요청 id 를 넘긴다', async () => {
    const { ipc, assistant } = setup()
    await expect(ipc.invoke(IPC_CHANNELS.ASSISTANT_CANCEL, { requestId: 'r1' })).resolves.toBe(true)
    expect(assistant.cancel).toHaveBeenCalledWith('r1')
    await ipc.invoke(IPC_CHANNELS.ASSISTANT_CANCEL)
    expect(assistant.cancel).toHaveBeenLastCalledWith(undefined)
  })
})

describe('createWebIpc — 막는 채널', () => {
  it.each([IPC_CHANNELS.DEMO_EARNINGS_START, IPC_CHANNELS.DEMO_EARNINGS_STOP])('%s 는 거절한다(방송은 서버가 돌린다)', async (channel) => {
    const { ipc, http } = setup()
    const error = await ipc.invoke(channel, { ticker: 'WMT' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({ code: 'BUSINESS_RULE', details: { unsupported: true, channel } })
    expect(http.getJson).not.toHaveBeenCalled()
  })

  it.each([
    IPC_CHANNELS.KIS_PLACE_MANUAL_ORDER,
    IPC_CHANNELS.KIS_GET_BALANCE,
    IPC_CHANNELS.AUTH_LOGIN,
    IPC_CHANNELS.WATCHLIST_ADD,
    IPC_CHANNELS.SETTINGS_SET_THEME,
    IPC_CHANNELS.KIS_GET_ASSET_TIMESERIES,
    IPC_CHANNELS.TRADES_GET,
    IPC_CHANNELS.WATCHLIST_GET,
    IPC_CHANNELS.HOLDINGS_TICKERS_UPDATE,
    IPC_CHANNELS.VAULT_SAVE,
    'terminal:없는:채널',
  ])('연결하지 않은 채널은 거절한다: %s', async (channel) => {
    const { ipc } = setup()
    await expect(ipc.invoke(channel, {})).rejects.toMatchObject({ code: 'BUSINESS_RULE', details: { unsupported: true, channel } })
  })
})

describe('createWebIpc — 메시지 거르기', () => {
  it('dropMessage 가 참이면 store 로 내보내지 않는다(끝난 회차의 늦은 대조)', async () => {
    const { stomp, handlers } = fakeStomp()
    const ipc = createWebIpc({
      http: { getJson: vi.fn() } as never,
      stomp,
      assistant: { ask: vi.fn(), cancel: vi.fn() },
      dropMessage: (channel, payload) => channel === IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED && (payload as { call_id?: string }).call_id === 'old',
    })
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED, listener)
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_DIFF_SUBSCRIBE, { ticker: 'WMT' })
    handlers.get('/topic/transcript-diff/WMT')!('{"call_id":"old"}')
    handlers.get('/topic/transcript-diff/WMT')!('{"call_id":"new"}')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ call_id: 'new' })
  })
})

describe('createWebIpc — 중간 입장 스냅샷', () => {
  function withSnapshot(snapshot = vi.fn(async () => ({ callId: 'c1', messages: [{ channel: IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, payload: { s: 0 } }] }))) {
    const { stomp, handlers, setStatus } = fakeStomp()
    const ipc = createWebIpc({ http: { getJson: vi.fn() } as never, stomp, assistant: { ask: vi.fn(), cancel: vi.fn() }, snapshot })
    const received: unknown[] = []
    ipc.on(IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, (p) => received.push(p))
    const connect = () => {
      stomp.status = 'CONNECTED'
      setStatus('CONNECTED')
    }
    return { ipc, stomp, handlers, connect, snapshot, received }
  }

  it('자막을 구독한 종목만, 연결될 때 스냅샷을 받는다', async () => {
    const { ipc, connect, snapshot } = withSnapshot()
    await ipc.invoke(IPC_CHANNELS.FACTCHECK_SUBSCRIBE, { ticker: 'AAPL' })
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    expect(snapshot).not.toHaveBeenCalled()
    connect()
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1))
    expect(snapshot).toHaveBeenCalledWith('WMT')
  })

  it('이미 연결된 뒤 구독하면 바로 받고, 다시 연결될 때마다 또 받는다', async () => {
    const { ipc, connect, snapshot } = withSnapshot()
    connect()
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1))
    // 같은 종목을 다시 구독해도 두 번 받지 않는다
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    connect()
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2))
  })

  it('보류 중 온 실시간 메시지는 스냅샷 뒤에 나온다', async () => {
    const { ipc, connect, handlers, received } = withSnapshot()
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    connect()
    handlers.get('/topic/transcript/WMT')!('{"s":1}')
    expect(received).toEqual([])
    await vi.waitFor(() => expect(received).toEqual([{ s: 0 }, { s: 1 }]))
  })

  it('구독을 풀었거나 연결을 끊은 종목은 다시 연결돼도 받지 않는다', async () => {
    const { ipc, connect, snapshot } = withSnapshot()
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_UNSUBSCRIBE, { ticker: 'WMT' })
    connect()
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'AAPL' })
    await ipc.invoke(IPC_CHANNELS.WS_DISCONNECT)
    connect()
    await new Promise((r) => setTimeout(r, 0))
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(snapshot).toHaveBeenCalledWith('AAPL')
  })

  it('보류했다 푸는 메시지도 그때 dropMessage 로 거른다(스냅샷이 회차를 끝낸 뒤의 늦은 대조)', async () => {
    const { stomp, handlers, setStatus } = fakeStomp()
    const retired = new Set<string>()
    const ipc = createWebIpc({
      http: { getJson: vi.fn() } as never,
      stomp,
      assistant: { ask: vi.fn(), cancel: vi.fn() },
      // 스냅샷을 내보내는 도중 회차가 끝났다고 표시한다
      snapshot: async () => ({ callId: 'new', messages: [{ channel: IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, payload: { retire: 'old' } }] }),
      dropMessage: (_channel, payload) => retired.has((payload as { call_id?: string }).call_id ?? ''),
    })
    ipc.on(IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, (p) => retired.add((p as { retire: string }).retire))
    const diffs = vi.fn()
    ipc.on(IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED, diffs)
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_DIFF_SUBSCRIBE, { ticker: 'WMT' })
    stomp.status = 'CONNECTED'
    setStatus('CONNECTED')
    handlers.get('/topic/transcript-diff/WMT')!('{"call_id":"old"}')
    handlers.get('/topic/transcript-diff/WMT')!('{"call_id":"new"}')
    await vi.waitFor(() => expect(diffs).toHaveBeenCalledTimes(1))
    expect(diffs).toHaveBeenCalledWith({ call_id: 'new' })
  })

  it('보류 중 구독을 풀면 스냅샷과 보류한 메시지를 내보내지 않는다', async () => {
    const { ipc, connect, handlers, received } = withSnapshot()
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    connect()
    handlers.get('/topic/transcript/WMT')!('{"s":1}')
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_UNSUBSCRIBE, { ticker: 'WMT' })
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toEqual([])
  })

  it('스냅샷을 주지 않으면(deps 없음) 보류하지 않는다', async () => {
    const { ipc, handlers, setStatus } = setup()
    const listener = vi.fn()
    ipc.on(IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, listener)
    await ipc.invoke(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, { ticker: 'WMT' })
    setStatus('CONNECTED')
    handlers.get('/topic/transcript/WMT')!('{"s":1}')
    expect(listener).toHaveBeenCalledWith({ s: 1 })
  })
})
