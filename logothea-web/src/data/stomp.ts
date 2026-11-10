import { Client, type IFrame } from '@stomp/stompjs'
import type { AuthProvider } from './auth'

/**
 * 브라우저 STOMP 연결. 터미널 `src/main/services/StompService.ts` 의 규칙을 옮겼다.
 *
 * - 토픽 구독 목록을 들고 있다가 (재)연결될 때마다 전부 다시 구독한다. 미연결 때 들어온 구독도 기록해 둔다.
 * - 재연결 타이머는 하나만 둔다. 한 장애에 오류 콜백 여러 개가 연달아 와도 client 가 두 개 생기지 않는다.
 * - 실패 콜백을 처음 받은 순간 그 client 를 떼어 낸다. 같은 장애로 뒤따르는 콜백(ERROR 프레임 뒤의 소켓 종료,
 *   error 뒤의 close)과 교체된 옛 client 의 콜백은 모두 무시한다.
 * - 서버가 인증 실패로 끊으면 토큰을 한 번만 갱신해 다시 붙는다. 갱신한 토큰도 거부되면 백오프로 넘어간다.
 *   갱신 결과가 없으면(null) 더 붙을 수단이 없으므로 멈춘다. 갱신 요청이 실패(reject)하면 일시 장애로 보고 백오프한다.
 *
 * 터미널과 다른 점
 * - 웹은 구독할 때마다 connect() 를 부른다. 연결 시도가 진행 중이면 그대로 둔다(새로 시작하지 않는다).
 * - 모바일에서는 화면 잠금 · 망 전환 뒤 소켓이 열린 채 죽는 일이 흔하다. 백엔드 simple broker 가 heart-beat 를
 *   0 으로 협상해 클라이언트가 이를 알아챌 수단이 없으므로, `reconnectNow()` 로 강제로 새로 붙는다
 *   (pageLifecycle.ts 가 화면 복귀 · 온라인 복귀 때 부른다).
 * - 시장 지수 · 시세 토픽은 구독하지 않는다. 웹은 어닝콜 토픽만 쓴다.
 */

export type WsStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING'

/** 이 모듈이 쓰는 @stomp/stompjs Client 의 일부. 테스트에서 가짜로 바꿔 끼운다. */
export interface StompClientLike {
  readonly connected: boolean
  activate(): void
  deactivate(): unknown
  subscribe(destination: string, callback: (message: { body: string }) => void): { unsubscribe(): void }
}

export interface StompClientConfig {
  url: string
  token: string
  onConnect: () => void
  onDisconnect: () => void
  onStompError: (message: string | undefined) => void
  onWebSocketError: () => void
  onWebSocketClose: () => void
}

export interface StompDeps {
  url: string
  auth: AuthProvider
  createClient?: (config: StompClientConfig) => StompClientLike
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface StompBridge {
  /** 연결돼 있거나 연결 중이면 아무것도 하지 않는다. */
  connect(): Promise<void>
  /** 지금 연결을 버리고 바로 새로 붙는다. 열린 채 죽은 소켓을 걷어 낼 때 쓴다. */
  reconnectNow(): Promise<void>
  disconnect(): void
  /** 같은 토픽을 다시 구독하면 핸들러만 바꾼다(중복 구독 없음). */
  subscribe(destination: string, handler: (body: string) => void): void
  unsubscribe(destination: string): void
  onStatus(listener: (status: WsStatus) => void): () => void
  readonly status: WsStatus
}

/** 백엔드 `StompJwtChannelInterceptor` 가 인증 실패 ERROR 프레임에 싣는 문구. */
export const STOMP_AUTH_ERROR = 'STOMP 인증 실패'
export const RETRY_DELAYS = [2000, 4000, 8000, 16000, 30000]
/** 이 시간 안에 CONNECTED 를 받지 못하면 소켓을 닫고 백오프로 넘어간다. */
export const CONNECTION_TIMEOUT_MS = 10_000

type Failure = 'disconnect' | 'socket-error' | 'socket-close' | 'auth' | 'stomp-error'

export function createStompBridge(deps: StompDeps): StompBridge {
  const createClient = deps.createClient ?? createBrowserClient
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  interface Topic {
    handler: (body: string) => void
    sub: { unsubscribe(): void } | null
  }
  const topics = new Map<string, Topic>()
  const statusListeners = new Set<(status: WsStatus) => void>()

  let client: StompClientLike | null = null
  let status: WsStatus = 'DISCONNECTED'
  let retryCount = 0
  let reconnectTimer: unknown = null
  let intentionalDisconnect = false
  let refreshedForAuthFailure = false
  /** 갱신해도 새 토큰을 받을 수 없다. 페이지를 새로 열기 전까지 다시 붙지 않는다. */
  let authExhausted = false
  let connecting: Promise<void> | null = null
  /** 인증 실패 뒤 토큰을 갱신하는 중. 그사이 connect() 가 옛 토큰으로 붙지 않게 이것을 기다리게 한다. */
  let refreshing: Promise<void> | null = null

  function setStatus(next: WsStatus) {
    if (status === next) return
    status = next
    for (const listener of statusListeners) {
      try {
        listener(next)
      } catch (e) {
        console.error('[stomp] 상태 리스너 오류:', e)
      }
    }
  }

  function subscribeOn(active: StompClientLike, destination: string, topic: Topic) {
    topic.sub = active.subscribe(destination, (message) => topic.handler(message.body))
  }

  function cancelTimer() {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer)
      reconnectTimer = null
    }
  }

  /** 재연결을 예약한다. 이미 예약돼 있으면 상태만 맞춘다. */
  function scheduleReconnect() {
    if (intentionalDisconnect || authExhausted) return
    setStatus('RECONNECTING')
    if (reconnectTimer !== null) return
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
    retryCount++
    reconnectTimer = setTimer(() => {
      reconnectTimer = null
      void bridge.connect()
    }, delay)
  }

  function dropSubscriptionHandles() {
    for (const topic of topics.values()) topic.sub = null
  }

  /** 지금 client 를 떼어 내고 닫는다. 떼어 낸 뒤 그 client 에서 오는 콜백은 모두 무시된다. */
  function detach() {
    const current = client
    client = null
    dropSubscriptionHandles()
    try {
      current?.deactivate()
    } catch (e) {
      console.error('[stomp] client 정리 실패:', e)
    }
  }

  function handleFailure(source: StompClientLike, failure: Failure) {
    if (client !== source) return
    detach()
    if (failure === 'auth' && !refreshedForAuthFailure) {
      refreshedForAuthFailure = true
      refreshing = reconnectWithRefreshedToken().finally(() => {
        refreshing = null
      })
      return
    }
    scheduleReconnect()
  }

  async function reconnectWithRefreshedToken() {
    setStatus('RECONNECTING')
    let token: string | null
    try {
      token = await deps.auth.refresh()
    } catch (e) {
      // 갱신 요청 자체의 실패는 일시 장애로 본다. 다음 시도에서 다시 갱신할 수 있게 플래그를 되돌린다.
      console.error('[stomp] 토큰 갱신 실패:', e)
      refreshedForAuthFailure = false
      scheduleReconnect()
      return
    }
    if (intentionalDisconnect) return
    if (!token) {
      // 다시 붙을 수단이 없다. 재연결 중으로 남겨 두면 화면이 영원히 기다린다.
      authExhausted = true
      cancelTimer()
      setStatus('DISCONNECTED')
      return
    }
    await startConnection()
  }

  async function openConnection(): Promise<void> {
    let token: string | null
    try {
      token = await deps.auth.getAccessToken()
    } catch (e) {
      console.error('[stomp] 토큰 조회 실패:', e)
      if (!intentionalDisconnect) scheduleReconnect()
      return
    }
    if (intentionalDisconnect || authExhausted) return
    if (!token) {
      setStatus('DISCONNECTED')
      return
    }
    cancelTimer()
    detach()
    setStatus('CONNECTING')

    const created: StompClientLike = createClient({
      url: deps.url,
      token,
      onConnect: () => {
        if (client !== created) return
        retryCount = 0
        refreshedForAuthFailure = false
        setStatus('CONNECTED')
        for (const [destination, topic] of topics) subscribeOn(created, destination, topic)
      },
      onDisconnect: () => handleFailure(created, 'disconnect'),
      onStompError: (message) => {
        if (client !== created) return
        console.error('[stomp] STOMP 오류:', message)
        handleFailure(created, message === STOMP_AUTH_ERROR ? 'auth' : 'stomp-error')
      },
      onWebSocketError: () => handleFailure(created, 'socket-error'),
      onWebSocketClose: () => handleFailure(created, 'socket-close'),
    })
    client = created
    created.activate()
  }

  /** 토큰을 기다리는 사이 여러 번 불려도 연결 시도는 하나만 한다. */
  function startConnection(): Promise<void> {
    intentionalDisconnect = false
    connecting ??= openConnection().finally(() => {
      connecting = null
    })
    return connecting
  }

  const bridge: StompBridge = {
    get status() {
      return status
    },

    connect() {
      if (authExhausted) return Promise.resolve()
      // disconnect() 직후 진행 중인 시도에 합류하는 경우에도 그 시도가 연결을 마치게 한다
      intentionalDisconnect = false
      if (refreshing) return refreshing
      if (connecting) return connecting
      if (client && (client.connected || status === 'CONNECTING')) return Promise.resolve()
      return startConnection()
    },

    reconnectNow() {
      if (authExhausted || intentionalDisconnect) return Promise.resolve()
      if (refreshing) return refreshing
      if (connecting) return connecting
      cancelTimer()
      retryCount = 0
      detach()
      return startConnection()
    },

    disconnect() {
      intentionalDisconnect = true
      cancelTimer()
      retryCount = 0
      detach()
      topics.clear()
      setStatus('DISCONNECTED')
    },

    subscribe(destination, handler) {
      const existing = topics.get(destination)
      if (existing) {
        existing.handler = handler
        return
      }
      const topic: Topic = { handler, sub: null }
      topics.set(destination, topic)
      if (client?.connected) subscribeOn(client, destination, topic)
    },

    unsubscribe(destination) {
      const topic = topics.get(destination)
      if (!topic) return
      topics.delete(destination)
      try {
        topic.sub?.unsubscribe()
      } catch (e) {
        console.error('[stomp] 구독 해제 실패:', e)
      }
    },

    onStatus(listener) {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
  }
  return bridge
}

function createBrowserClient(config: StompClientConfig): StompClientLike {
  return new Client({
    brokerURL: config.url,
    connectHeaders: { Authorization: `Bearer ${config.token}` },
    // 백엔드가 0 으로 협상해 지금은 꺼진다. 백엔드가 heart-beat 를 켜면 그대로 살아난다.
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    discardWebsocketOnCommFailure: true,
    reconnectDelay: 0, // 재연결은 위에서 직접 관리한다
    onConnect: () => config.onConnect(),
    onDisconnect: () => config.onDisconnect(),
    // 프레임 전체를 남기면 헤더가 로그에 남는다 — 메시지만 넘긴다
    onStompError: (frame: IFrame) => config.onStompError(frame.headers?.message),
    onWebSocketError: () => config.onWebSocketError(),
    onWebSocketClose: () => config.onWebSocketClose(),
  })
}
