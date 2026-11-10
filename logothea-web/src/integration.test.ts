import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipc as terminalIpcImport } from '@terminal/renderer/lib/ipc'
import { useGlossaryStore } from '@terminal/renderer/store/useGlossaryStore'
import { useAssistantStore } from '@terminal/renderer/store/useAssistantStore'
import { useTranscriptStore } from '@terminal/renderer/store/useTranscriptStore'
import { webIpc } from './data/runtime'

/**
 * 터미널 store 를 고치지 않고 웹 연결 묶음으로 돌리는지 확인한다.
 * 실서버 대신 fetch 만 가짜로 바꾼다. 나머지(플러그인 바꿔 끼우기 · runtime · http · assistant)는 실제 코드다.
 */

const encoder = new TextEncoder()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('터미널 store × 웹 연결', () => {
  it('터미널 ipc 모듈을 import 하면 웹 구현이 나온다', () => {
    expect(terminalIpcImport).toBe(webIpc)
  })

  it('용어 사전 store 가 웹 http 로 사전을 받아 ready 가 된다', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 'v1', terms: [{ term: 'comp sales', aliases: [], ko: '동일 점포 매출', category: 'metric' }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    await useGlossaryStore.getState().load()

    expect(useGlossaryStore.getState().status).toBe('ready')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://backend.test/api/v1/glossary')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('질의응답 store 가 웹 스트림으로 답을 받아 answered 가 된다', async () => {
    useTranscriptStore.getState().upsertSegment({
      ticker: 'WMT', call_id: 'call-1', sequence: 0, start_ms: 0, end_ms: 1000, text: 'Hello', timestamp: 1,
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event:delta\ndata:{"text":"매출이 늘었습니다"}\n\nevent:done\ndata:{"status":"answered"}\n\n'))
          controller.close()
        },
      })
      return new Response(body, { status: 200 })
    }))

    const store = useAssistantStore.getState()
    store.open({ ticker: 'WMT', callId: 'call-1' })
    await store.ask({ question: '요약해 줘' })
    await vi.waitFor(() => expect(useAssistantStore.getState().activeTurnId).toBeNull())

    const turn = useAssistantStore.getState().conversation!.turns[0]
    expect(turn.status).toBe('answered')
    expect(turn.text).toBe('매출이 늘었습니다')
  })
})
