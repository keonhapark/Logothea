import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { IpcError, isIpcError } from '@terminal/lib/types/ipcError'
import type { AssistantAskRequest } from '@terminal/lib/types/assistant'
import type { SpeakerProfile } from '@terminal/renderer/types/speakerProfile'
import type { AssistantStream } from './assistant'
import type { HttpClient } from './http'
import type { StompBridge } from './stomp'

/**
 * 터미널 `ipc.invoke` / `ipc.on` 의 브라우저 구현.
 *
 * 터미널 훅 · store 는 Electron main 프로세스에 채널 이름으로 요청하고 push 를 받는다. 웹에는 main 이 없으므로
 * 같은 채널 이름을 받아 백엔드 REST · STOMP 로 직접 보낸다. 어닝콜 채널만 연결하고 나머지(주문 · 계좌 · KIS ·
 * 관심종목 · 설정 등)는 거절한다. 거절에 쓸 전용 코드가 IpcErrorCode 에 없어 BUSINESS_RULE 에 details.unsupported 를 싣는다.
 */

export interface WebIpc {
  invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

export interface WebIpcDeps {
  http: Pick<HttpClient, 'getJson'>
  stomp: StompBridge
  assistant: AssistantStream
}

/** SUBSCRIBE 채널 → STOMP 토픽 접두사와 메시지를 내보낼 채널. 터미널 StompService 의 토픽과 같다. */
const TOPIC_CHANNELS: ReadonlyArray<{ subscribe: string; unsubscribe: string; prefix: string; received: string }> = [
  {
    subscribe: IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE,
    unsubscribe: IPC_CHANNELS.TRANSCRIPT_UNSUBSCRIBE,
    prefix: '/topic/transcript/',
    received: IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED,
  },
  {
    subscribe: IPC_CHANNELS.FACTCHECK_SUBSCRIBE,
    unsubscribe: IPC_CHANNELS.FACTCHECK_UNSUBSCRIBE,
    prefix: '/topic/factcheck/',
    received: IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED,
  },
  {
    subscribe: IPC_CHANNELS.TRANSCRIPT_DIFF_SUBSCRIBE,
    unsubscribe: IPC_CHANNELS.TRANSCRIPT_DIFF_UNSUBSCRIBE,
    prefix: '/topic/transcript-diff/',
    received: IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED,
  },
  {
    subscribe: IPC_CHANNELS.TRANSCRIPT_TRANSLATION_SUBSCRIBE,
    unsubscribe: IPC_CHANNELS.TRANSCRIPT_TRANSLATION_UNSUBSCRIBE,
    prefix: '/topic/transcript-translation/',
    received: IPC_CHANNELS.TRANSCRIPT_TRANSLATION_RECEIVED,
  },
  {
    subscribe: IPC_CHANNELS.EVALUATION_SUBSCRIBE,
    unsubscribe: IPC_CHANNELS.EVALUATION_UNSUBSCRIBE,
    prefix: '/topic/evaluation/',
    received: IPC_CHANNELS.EVALUATION_RECEIVED,
  },
]

/** 토픽 경로에 그대로 들어가므로 종목 기호 모양만 받는다. */
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,9}$/

const MAX_QUESTION_CHARS = 500
const MAX_HISTORY_MESSAGES = 6

export function createWebIpc(deps: WebIpcDeps): WebIpc {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  function emit(channel: string, payload: unknown) {
    for (const listener of listeners.get(channel) ?? []) {
      try {
        listener(payload)
      } catch (e) {
        console.error(`[webIpc] ${channel} 리스너 오류:`, e)
      }
    }
  }

  deps.stomp.onStatus((status) => emit(IPC_CHANNELS.WS_STATUS_CHANGED, { status }))

  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()

  for (const route of TOPIC_CHANNELS) {
    handlers.set(route.subscribe, async (payload) => {
      const ticker = tickerOf(payload)
      if (!ticker) {
        // 화면은 조용히 비어 있게 된다. 원인을 찾을 수 있게 남긴다.
        console.warn(`[webIpc] 종목 기호 형식이 아니라 구독하지 않습니다: ${route.subscribe}`, payload)
        return
      }
      deps.stomp.subscribe(route.prefix + ticker, (body) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch (e) {
          console.error(`[webIpc] ${route.prefix} 메시지 파싱 실패:`, e)
          return
        }
        emit(route.received, parsed)
      })
      void deps.stomp.connect()
    })
    handlers.set(route.unsubscribe, async (payload) => {
      const ticker = tickerOf(payload)
      if (ticker) deps.stomp.unsubscribe(route.prefix + ticker)
    })
  }

  handlers.set(IPC_CHANNELS.WS_CONNECT, async () => {
    await deps.stomp.connect()
  })
  handlers.set(IPC_CHANNELS.WS_DISCONNECT, async () => {
    deps.stomp.disconnect()
  })

  // 사전이 없어도 자막 · 번역은 보여야 하므로 실패는 null. AUTH_EXPIRED 만 터미널 handler 처럼 그대로 던진다.
  handlers.set(IPC_CHANNELS.GLOSSARY_GET, async () => {
    try {
      return await deps.http.getJson('/api/v1/glossary')
    } catch (e) {
      if (isIpcError(e) && e.code === 'AUTH_EXPIRED') throw e
      console.error('[webIpc] 용어 사전 조회 실패:', e)
      return null
    }
  })

  // 명부는 부가 정보라 실패하면 빈 배열(터미널 BackendClient.getEarningsSpeakers 와 같은 변환).
  handlers.set(IPC_CHANNELS.DEMO_EARNINGS_SPEAKERS, async () => {
    try {
      return toSpeakerProfiles(await deps.http.getJson('/api/v1/demo/earnings-call/speakers'))
    } catch {
      return []
    }
  })

  handlers.set(IPC_CHANNELS.ASSISTANT_ASK, async (payload) => {
    if (!isValidAskRequest(payload)) throw new IpcError('VALIDATION', '질문 형식이 올바르지 않습니다.')
    return deps.assistant.ask(payload, (event) => emit(IPC_CHANNELS.ASSISTANT_EVENT, event))
  })
  handlers.set(IPC_CHANNELS.ASSISTANT_CANCEL, async (payload) => {
    const requestId = (payload as { requestId?: unknown } | null | undefined)?.requestId
    return deps.assistant.cancel(typeof requestId === 'string' ? requestId : undefined)
  })

  // 방송은 서버가 돌린다. 관람객 한 명이 멈추거나 다시 시작하면 다른 모든 관람객의 콜이 끊긴다.
  for (const channel of [IPC_CHANNELS.DEMO_EARNINGS_START, IPC_CHANNELS.DEMO_EARNINGS_STOP]) {
    handlers.set(channel, async () => {
      throw unsupported(channel, '전시용 웹에서는 콜 재생을 조작할 수 없습니다.')
    })
  }

  return {
    invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
      const handler = handlers.get(channel)
      if (!handler) return Promise.reject(unsupported(channel, '전시용 웹에서 지원하지 않는 기능입니다.'))
      return handler(payload) as Promise<T>
    },
    on: (channel, listener) => {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
  }
}

function unsupported(channel: string, message: string): IpcError {
  return new IpcError('BUSINESS_RULE', message, { unsupported: true, channel })
}

function tickerOf(payload: unknown): string | null {
  const ticker = (payload as { ticker?: unknown } | null | undefined)?.ticker
  return typeof ticker === 'string' && TICKER_PATTERN.test(ticker) ? ticker : null
}

/** 터미널 assistantHandlers 의 형식 검증과 같다. 잘못된 요청으로 하루 횟수를 쓰지 않게 먼저 거른다. */
export function isValidAskRequest(value: unknown): value is AssistantAskRequest {
  if (value === null || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  const question = typeof r.question === 'string' ? r.question.trim() : ''
  return (
    typeof r.requestId === 'string' && r.requestId.length > 0 &&
    typeof r.ticker === 'string' && r.ticker.length > 0 &&
    typeof r.callId === 'string' && r.callId.length > 0 &&
    Number.isInteger(r.asOfSequence) && (r.asOfSequence as number) >= 0 &&
    (r.anchorSequence === null || (Number.isInteger(r.anchorSequence) && (r.anchorSequence as number) >= 0)) &&
    question.length > 0 && question.length <= MAX_QUESTION_CHARS &&
    (r.suggestedQuestionId === null || typeof r.suggestedQuestionId === 'string') &&
    Array.isArray(r.history) && r.history.length <= MAX_HISTORY_MESSAGES &&
    r.history.every(
      (turn) =>
        turn !== null && typeof turn === 'object' &&
        ((turn as Record<string, unknown>).role === 'user' || (turn as Record<string, unknown>).role === 'assistant') &&
        typeof (turn as Record<string, unknown>).text === 'string',
    )
  )
}

/** speakers 응답(snake_case) → SpeakerProfile. 터미널 BackendClient.getEarningsSpeakers 와 같은 규칙. */
export function toSpeakerProfiles(data: unknown): SpeakerProfile[] {
  if (!Array.isArray(data)) return []
  const seen = new Set<string>()
  return data.flatMap((raw: Record<string, unknown> | null) => {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) return []
    const rawKey = typeof raw?.match_key === 'string' ? raw.match_key.trim() : ''
    const matchKey = (rawKey || name).toLowerCase()
    if (seen.has(matchKey)) return []
    seen.add(matchKey)
    return [{
      matchKey,
      name,
      title: typeof raw?.title === 'string' ? raw.title : '',
      affiliation: typeof raw?.affiliation === 'string' ? raw.affiliation : '',
      kind: raw?.analyst === true ? ('ANALYST' as const) : ('MANAGEMENT' as const),
    }]
  })
}
