import { IpcError, type IpcErrorCode } from '@terminal/lib/types/ipcError'
import { SseParser } from '@terminal/lib/sse'
import type {
  AssistantAskRequest,
  AssistantAskStarted,
  AssistantEventType,
  AssistantRejection,
  AssistantStreamEvent,
} from '@terminal/lib/types/assistant'
import { readJsonObject, type HttpClient } from './http'

/**
 * 어닝콜 질의응답 스트림 (Contract 7.10). 터미널 `src/main/services/AssistantStreamService.ts` 를 브라우저로 옮겼다.
 *
 * 바뀐 점은 인증뿐이다. 토큰 첨부와 401 갱신 재시도는 HttpClient 가 맡는다. 나머지 규칙은 같다.
 * - 질문은 한 번에 하나. 새 질문이 오면 이전 연결을 끊는다. 끊으면 backend 가 생성을 멈춘다.
 * - 직전 연결을 닫은 뒤 10초 안의 409 assistant_busy 는 잠깐 기다렸다 다시 보낸다(backend 잠금 해제 대기).
 * - 바이트가 15초 동안 오지 않으면 끊긴 것으로 보고 stream_interrupted 를 한 번 민다.
 * - 스트림 전 거절은 IpcError(details: AssistantRejection) 로 reject 한다. 터미널 store 가 그대로 읽는다.
 */

export type AssistantEventSink = (event: AssistantStreamEvent) => void

export interface AssistantStreamDeps {
  http: Pick<HttpClient, 'request'>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  idleTimeoutMs?: number
}

export interface AssistantStream {
  ask(request: AssistantAskRequest, sink: AssistantEventSink): Promise<AssistantAskStarted>
  cancel(requestId?: string): boolean
}

const EVENT_TYPES = new Set<AssistantEventType>(['meta', 'delta', 'citations', 'done', 'error'])
const TERMINAL_EVENTS = new Set<AssistantEventType>(['done', 'error'])
const BUSY_RETRY_WINDOW_MS = 10_000
const BUSY_RETRY_DELAYS_MS = [1_500, 2_500, 3_500]
export const STREAM_IDLE_TIMEOUT_MS = 15_000

const MESSAGES = {
  network: '서버에 연결하지 못했습니다.',
  cancelled: '질문을 취소했습니다.',
  auth: '접속이 만료됐습니다. 페이지를 새로 고쳐 주세요.',
  failed: '질문을 보내지 못했습니다.',
  interrupted: '답변 전송이 중간에 끊겼습니다.',
}

interface ActiveRequest {
  requestId: string
  controller: AbortController
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

export function createAssistantStream(deps: AssistantStreamDeps): AssistantStream {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? (() => Date.now())
  const idleTimeoutMs = deps.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS
  let active: ActiveRequest | null = null
  let lastCloseAt = Number.NEGATIVE_INFINITY

  function cancel(requestId?: string): boolean {
    const current = active
    if (!current || (requestId !== undefined && current.requestId !== requestId)) return false
    active = null
    lastCloseAt = now()
    current.controller.abort()
    void current.reader?.cancel().catch(() => undefined)
    return true
  }

  async function open(request: AssistantAskRequest, signal: AbortSignal): Promise<Response> {
    let busyAttempts = 0
    for (;;) {
      let response: Response
      try {
        response = await deps.http.request('/api/v1/assistant/ask', {
          method: 'POST',
          signal,
          headers: { Accept: 'text/event-stream, application/json' },
          body: toBody(request),
        })
      } catch {
        if (signal.aborted) throw rejection('BUSINESS_RULE', 0, 'cancelled', MESSAGES.cancelled)
        throw rejection('NETWORK', 0, 'network', MESSAGES.network)
      }
      if (response.ok) return response

      const body = await readJsonObject(response)
      const code = typeof body.code === 'string' ? body.code : null
      const recentlyClosed = now() - lastCloseAt < BUSY_RETRY_WINDOW_MS
      if (response.status === 409 && code === 'assistant_busy' && recentlyClosed && busyAttempts < BUSY_RETRY_DELAYS_MS.length) {
        await sleep(BUSY_RETRY_DELAYS_MS[busyAttempts])
        busyAttempts += 1
        if (signal.aborted) throw rejection('BUSINESS_RULE', 0, 'cancelled', MESSAGES.cancelled)
        continue
      }
      if (response.status === 401) throw rejection('AUTH_EXPIRED', 401, code, MESSAGES.auth)
      const message = typeof body.error === 'string' ? body.error : MESSAGES.failed
      const resetAt = typeof body.reset_at === 'string' ? body.reset_at : null
      throw rejection(errorCodeFor(response.status), response.status, code, message, resetAt)
    }
  }

  async function pump(current: ActiveRequest, sink: AssistantEventSink): Promise<void> {
    const reader = current.reader as ReadableStreamDefaultReader<Uint8Array>
    const parser = new SseParser()
    const decoder = new TextDecoder()
    let sinkFailed = false
    const emit = (type: AssistantEventType, data: unknown) => {
      if (sinkFailed) return
      try {
        sink({ requestId: current.requestId, type, data })
      } catch {
        sinkFailed = true
        current.controller.abort()
      }
    }
    let terminal = false
    let interrupted = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let idleFired = false
    try {
      reading: for (;;) {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          idleFired = true
          current.controller.abort()
          void reader.cancel().catch(() => undefined)
        }, idleTimeoutMs)
        const { done, value } = await reader.read()
        if (done) break
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (!EVENT_TYPES.has(frame.event as AssistantEventType)) continue
          let data: unknown
          try {
            data = JSON.parse(frame.data)
          } catch {
            continue
          }
          emit(frame.event as AssistantEventType, data)
          if (TERMINAL_EVENTS.has(frame.event as AssistantEventType)) {
            terminal = true
            break reading
          }
        }
      }
      interrupted = !terminal && (idleFired || !current.controller.signal.aborted)
    } catch {
      // 사용자가 취소했으면 화면은 이미 취소 상태다. 그 밖의 읽기 실패는 끊김으로 알린다.
      interrupted = idleFired || !current.controller.signal.aborted
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      // 연결을 우리가 닫는 시점이다. backend 가 아직 잠금을 쥐고 있을 수 있어 409 재시도 기준으로 삼는다.
      lastCloseAt = now()
      if (active === current) active = null
      current.controller.abort()
      void reader.cancel().catch(() => undefined)
    }
    if (interrupted) emit('error', { code: 'stream_interrupted', message: MESSAGES.interrupted })
  }

  return {
    cancel,
    async ask(request, sink) {
      cancel()
      const controller = new AbortController()
      const current: ActiveRequest = { requestId: request.requestId, controller, reader: null }
      active = current
      let response: Response
      try {
        response = await open(request, controller.signal)
      } catch (error) {
        if (active === current) active = null
        throw error
      }
      if (active !== current) {
        controller.abort()
        throw rejection('BUSINESS_RULE', 0, 'cancelled', MESSAGES.cancelled)
      }
      if (!response.body) {
        active = null
        controller.abort()
        throw rejection('UNKNOWN', 0, 'stream_interrupted', MESSAGES.interrupted)
      }
      current.reader = response.body.getReader()
      void pump(current, sink)
      return { requestId: request.requestId }
    },
  }
}

function toBody(request: AssistantAskRequest) {
  return {
    ticker: request.ticker,
    call_id: request.callId,
    as_of_sequence: request.asOfSequence,
    anchor_sequence: request.anchorSequence,
    question: request.question,
    suggested_question_id: request.suggestedQuestionId,
    history: request.history.map((turn) => ({ role: turn.role, text: turn.text })),
  }
}

function errorCodeFor(status: number): IpcErrorCode {
  if (status === 400) return 'VALIDATION'
  if (status === 404 || status === 409 || status === 429) return 'BUSINESS_RULE'
  if (status >= 500) return 'BACKEND_5XX'
  return 'UNKNOWN'
}

function rejection(
  ipcCode: IpcErrorCode,
  status: number,
  code: string | null,
  message: string,
  resetAt: string | null = null,
): IpcError {
  const details: AssistantRejection = { status, code, message, resetAt }
  return new IpcError(ipcCode, message, details)
}
