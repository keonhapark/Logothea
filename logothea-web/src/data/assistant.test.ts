import { describe, expect, it, vi } from 'vitest'
import { IpcError } from '@terminal/lib/types/ipcError'
import type { AssistantAskRequest, AssistantStreamEvent } from '@terminal/lib/types/assistant'
import { createAssistantStream } from './assistant'
import type { RequestOptions } from './http'

const encoder = new TextEncoder()

function sseResponse(chunks: string[], keepOpen = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (!keepOpen) controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function request(overrides: Partial<AssistantAskRequest> = {}): AssistantAskRequest {
  return {
    requestId: 'r1', ticker: 'WMT', callId: 'call-1', asOfSequence: 17, anchorSequence: null,
    question: '요약해 줘', suggestedQuestionId: 'summary', history: [{ role: 'user', text: '앞 질문' }],
    ...overrides,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function setup(
  impl: (path: string, options: RequestOptions) => Promise<Response>,
  extra: { now?: () => number; idleTimeoutMs?: number } = {},
) {
  const httpRequest = vi.fn(impl)
  const sleep = vi.fn(async () => undefined)
  const stream = createAssistantStream({
    http: { request: httpRequest },
    sleep,
    now: extra.now ?? (() => 1_000_000),
    idleTimeoutMs: extra.idleTimeoutMs,
  })
  const events: AssistantStreamEvent[] = []
  return { httpRequest, sleep, stream, events, sink: (e: AssistantStreamEvent) => events.push(e) }
}

describe('createAssistantStream', () => {
  it('snake_case 본문과 SSE Accept 로 보내고 끝 이벤트까지 순서대로 민다', async () => {
    const { httpRequest, stream, events, sink } = setup(async () =>
      sseResponse([
        'event:meta\ndata:{"scope": "call"}\n\n:\n\n',
        'event:delta\ndata:{"text": "매',
        '출"}\n\nevent:citations\ndata:[]\n\n',
        'event:done\ndata:{"status": "answered"}\n\nevent:delta\ndata:{"text": "늦은 조각"}\n\n',
      ]),
    )
    await expect(stream.ask(request(), sink)).resolves.toEqual({ requestId: 'r1' })
    await flush()

    const [path, options] = httpRequest.mock.calls[0]
    expect(path).toBe('/api/v1/assistant/ask')
    expect(options.method).toBe('POST')
    expect(options.headers?.Accept).toBe('text/event-stream, application/json')
    expect(options.body).toEqual({
      ticker: 'WMT', call_id: 'call-1', as_of_sequence: 17, anchor_sequence: null,
      question: '요약해 줘', suggested_question_id: 'summary', history: [{ role: 'user', text: '앞 질문' }],
    })
    expect(events.map((e) => [e.requestId, e.type, e.data])).toEqual([
      ['r1', 'meta', { scope: 'call' }],
      ['r1', 'delta', { text: '매출' }],
      ['r1', 'citations', []],
      ['r1', 'done', { status: 'answered' }],
    ])
  })

  it('끝 이벤트 없이 스트림이 끝나면 stream_interrupted 를 민다', async () => {
    const { stream, events, sink } = setup(async () => sseResponse(['event:delta\ndata:{"text":"a"}\n\n']))
    await stream.ask(request(), sink)
    await flush()
    expect(events.at(-1)).toMatchObject({ type: 'error', data: { code: 'stream_interrupted' } })
  })

  it('JSON 이 아닌 data 와 모르는 이벤트는 건너뛴다', async () => {
    const { stream, events, sink } = setup(async () =>
      sseResponse(['event:delta\ndata:깨진\n\nevent:unknown\ndata:{}\n\nevent:done\ndata:{}\n\n']),
    )
    await stream.ask(request(), sink)
    await flush()
    expect(events.map((e) => e.type)).toEqual(['done'])
  })

  it('401 은 AUTH_EXPIRED 로 거절한다(갱신 재시도는 HttpClient 가 이미 했다)', async () => {
    const { stream, sink } = setup(async () => jsonResponse(401, {}))
    await expect(stream.ask(request(), sink)).rejects.toMatchObject({ code: 'AUTH_EXPIRED', details: { status: 401 } })
  })

  it('429 는 BUSINESS_RULE 과 reset_at 을 details 로 넘긴다', async () => {
    const { stream, sink } = setup(async () =>
      jsonResponse(429, { error: '오늘 질문을 다 썼습니다.', code: 'daily_limit_exceeded', reset_at: '2026-11-11T15:00:00Z' }),
    )
    const error = await stream.ask(request(), sink).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({
      code: 'BUSINESS_RULE',
      details: { status: 429, code: 'daily_limit_exceeded', message: '오늘 질문을 다 썼습니다.', resetAt: '2026-11-11T15:00:00Z' },
    })
  })

  it.each([
    [400, 'VALIDATION'],
    [404, 'BUSINESS_RULE'],
    [503, 'BACKEND_5XX'],
  ])('%i → %s', async (status, code) => {
    const { stream, sink } = setup(async () => jsonResponse(status, { error: 'x' }))
    await expect(stream.ask(request(), sink)).rejects.toMatchObject({ code })
  })

  it('연결 실패는 NETWORK', async () => {
    const { stream, sink } = setup(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(stream.ask(request(), sink)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('취소 직후의 409 assistant_busy 는 잠시 기다렸다 다시 보낸다', async () => {
    let calls = 0
    const { stream, sleep, sink } = setup(async () => {
      calls += 1
      if (calls === 1) return sseResponse([], true)
      if (calls === 2) return jsonResponse(409, { code: 'assistant_busy', error: '진행 중' })
      return sseResponse(['event:done\ndata:{}\n\n'])
    })
    await stream.ask(request({ requestId: 'r1' }), sink)
    expect(stream.cancel()).toBe(true)
    await expect(stream.ask(request({ requestId: 'r2' }), sink)).resolves.toEqual({ requestId: 'r2' })
    expect(sleep).toHaveBeenCalledWith(1_500)
    expect(calls).toBe(3)
  })

  it('최근에 닫은 연결이 없으면 409 를 바로 거절로 돌려준다', async () => {
    const { stream, sleep, sink } = setup(async () => jsonResponse(409, { code: 'assistant_busy', error: '진행 중' }))
    await expect(stream.ask(request(), sink)).rejects.toMatchObject({ code: 'BUSINESS_RULE', details: { code: 'assistant_busy' } })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('409 재시도는 세 번까지만 한다', async () => {
    let calls = 0
    const { stream, sleep, sink } = setup(async () => {
      calls += 1
      if (calls === 1) return sseResponse([], true)
      return jsonResponse(409, { code: 'assistant_busy' })
    })
    await stream.ask(request({ requestId: 'r1' }), sink)
    stream.cancel()
    await expect(stream.ask(request({ requestId: 'r2' }), sink)).rejects.toMatchObject({ details: { status: 409 } })
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1_500, 2_500, 3_500])
  })

  it('취소하면 연결을 끊고 더 이상 이벤트를 밀지 않는다(끊김 오류도 없음)', async () => {
    let push: (chunk: string) => void = () => undefined
    const { stream, events, sink } = setup(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (chunk) => controller.enqueue(encoder.encode(chunk))
        },
      })
      return new Response(body, { status: 200 })
    })
    await stream.ask(request(), sink)
    push('event:delta\ndata:{"text":"a"}\n\n')
    await flush()
    expect(stream.cancel('r1')).toBe(true)
    await flush()
    expect(events.map((e) => e.type)).toEqual(['delta'])
  })

  it('다른 요청 id 로는 취소되지 않는다', async () => {
    const { stream, sink } = setup(async () => sseResponse([], true))
    await stream.ask(request(), sink)
    expect(stream.cancel('other')).toBe(false)
    expect(stream.cancel('r1')).toBe(true)
  })

  it('sink 가 던지면 연결을 끊고 더 이상 밀지 않는다', async () => {
    const { stream } = setup(async () =>
      sseResponse(['event:delta\ndata:{"text":"a"}\n\nevent:delta\ndata:{"text":"b"}\n\nevent:done\ndata:{}\n\n']),
    )
    const sink = vi.fn(() => {
      throw new Error('화면 오류')
    })
    await stream.ask(request(), sink)
    await flush()
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('바이트가 한동안 오지 않으면 연결을 끊고 stream_interrupted 를 한 번 민다', async () => {
    const { stream, events, sink } = setup(async () => sseResponse(['event:meta\ndata:{}\n\n'], true), { idleTimeoutMs: 20 })
    await stream.ask(request(), sink)
    await new Promise((resolve) => setTimeout(resolve, 60))
    await flush()
    expect(events.map((e) => e.type)).toEqual(['meta', 'error'])
    expect(events[1].data).toMatchObject({ code: 'stream_interrupted' })
  })

  it('새 질문은 진행 중인 이전 질문을 끊는다', async () => {
    const signals: AbortSignal[] = []
    const { stream, events, sink } = setup(async (_path, options) => {
      signals.push(options.signal!)
      return signals.length === 1 ? sseResponse(['event:meta\ndata:{}\n\n'], true) : sseResponse(['event:done\ndata:{}\n\n'])
    })
    await stream.ask(request({ requestId: 'r1' }), sink)
    await flush()
    await stream.ask(request({ requestId: 'r2' }), sink)
    await flush()
    expect(signals[0].aborted).toBe(true)
    expect(events.map((e) => [e.requestId, e.type])).toEqual([['r1', 'meta'], ['r2', 'done']])
  })

  it('답변이 끝난 직후의 409 assistant_busy 도 다시 시도한다', async () => {
    let calls = 0
    const { stream, sleep, sink } = setup(async () => {
      calls += 1
      if (calls === 1) return sseResponse(['event:done\ndata:{}\n\n'])
      if (calls === 2) return jsonResponse(409, { code: 'assistant_busy' })
      return sseResponse(['event:done\ndata:{}\n\n'])
    })
    await stream.ask(request({ requestId: 'r1' }), sink)
    await flush()
    await expect(stream.ask(request({ requestId: 'r2' }), sink)).resolves.toEqual({ requestId: 'r2' })
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('거절된 요청은 진행 중으로 남지 않아 cancel 이 false', async () => {
    const { stream, sink } = setup(async () => jsonResponse(429, { code: 'daily_limit_exceeded' }))
    await stream.ask(request(), sink).catch(() => undefined)
    expect(stream.cancel()).toBe(false)
  })

  it('418 같은 그 밖의 상태는 UNKNOWN', async () => {
    const { stream, sink } = setup(async () => jsonResponse(418, {}))
    await expect(stream.ask(request(), sink)).rejects.toMatchObject({ code: 'UNKNOWN', details: { status: 418 } })
  })

  it('시간 안에 계속 바이트가 오면 끊지 않는다', async () => {
    let push: (chunk: string) => void = () => undefined
    let close: () => void = () => undefined
    const { stream, events, sink } = setup(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              push = (chunk) => controller.enqueue(encoder.encode(chunk))
              close = () => controller.close()
            },
          }),
          { status: 200 },
        ),
      { idleTimeoutMs: 40 },
    )
    await stream.ask(request(), sink)
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      push(':\n\n')
    }
    push('event:done\ndata:{}\n\n')
    close()
    await flush()
    expect(events.map((e) => e.type)).toEqual(['done'])
  })
})
