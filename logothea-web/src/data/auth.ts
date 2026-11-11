/**
 * 백엔드 액세스 토큰을 건네는 쪽. http · stomp · assistant 는 이 인터페이스만 본다.
 * 토큰은 메모리에만 두고 쿠키는 쓰지 않는다.
 *
 * 돌려주는 값의 뜻(호출 측이 이 구분으로 동작을 정한다):
 * - 토큰: 그 토큰으로 보낸다.
 * - null: 붙을 수단이 없다. STOMP 는 연결하지 않고 멈추며, REST 는 토큰 없이 보내 401 이면 AUTH_EXPIRED 가 된다.
 * - reject: 일시 장애다. STOMP 는 백오프로 다시 시도하고, REST 는 NETWORK 오류가 된다.
 */
export interface AuthProvider {
  /** 지금 쓸 토큰. */
  getAccessToken(): Promise<string | null>
  /**
   * 서버가 토큰을 거부했을 때 부른다. 새 토큰을 받는다.
   * rejected 에 거부된 토큰을 주면, 다른 요청이 이미 새로 받아 둔 토큰이 있을 때 그것을 돌려준다(한 번만 발급).
   */
  refresh(rejected?: string | null): Promise<string | null>
}

/**
 * 로컬 백엔드에서 로그인해 얻은 토큰을 환경 변수로 넣어 쓰는 개발용 구현.
 * 갱신 수단이 없어 refresh 는 늘 null 이다. 로컬 백엔드를 `--jwt.expiration-ms=86400000` 으로 띄우면
 * 15분마다 토큰을 다시 넣지 않아도 된다.
 */
export function createDevTokenProvider(token: string | undefined): AuthProvider {
  const value = token?.trim() ? token.trim() : null
  return {
    getAccessToken: async () => value,
    refresh: async () => null,
  }
}

// ── 게스트 토큰 (Contract 7.1.1) ─────────────────────────────────────────

/**
 * - idle: 아직 받지 않음
 * - ready: 받은 토큰이 있음
 * - disabled: 서버에서 게스트 발급이 꺼짐(404). 페이지를 새로 열기 전까지 다시 묻지 않는다
 * - rate_limited: 같은 IP 의 1분 발급 수 초과(429 guest_rate_limited). 잠시 뒤 다시 묻는다
 * - unavailable: 서버 장애 · 연결 실패(503 guest_unavailable 등). 잠시 뒤 다시 묻는다
 */
export type GuestStatus = 'idle' | 'ready' | 'disabled' | 'rate_limited' | 'unavailable'

export class GuestTokenError extends Error {
  constructor(readonly status: GuestStatus) {
    super(`게스트 토큰을 받지 못했습니다: ${status}`)
    this.name = 'GuestTokenError'
  }
}

export interface GuestTokenProvider extends AuthProvider {
  readonly status: GuestStatus
  onStatus(listener: (status: GuestStatus) => void): () => void
}

export interface GuestTokenDeps {
  baseUrl: string
  fetch?: typeof fetch
  now?: () => number
  /** 0 이상 1 미만. 대기 시간을 흩뜨리는 데 쓴다. */
  random?: () => number
}

/** 만료 이만큼 전에 미리 새로 받는다(토큰 수명의 절반을 넘지 않는다). 오래 연 STOMP 를 다시 붙일 때 만료 직전 토큰을 쓰지 않게 한다. */
export const RENEW_BEFORE_MS = 60_000
/**
 * 다시 묻기 전에 기다리는 시간. 그사이 요청은 서버에 묻지 않고 바로 실패한다(백오프하는 호출 측이 여럿이라도 한 번만 묻는다).
 * 전시장에서는 관람객이 한 IP 의 1분 발급 한도를 함께 쓰므로, 장애 뒤 모두가 같은 순간에 다시 묻지 않도록 ±30% 흩뜨린다.
 * 429 에 Retry-After(초)가 있으면 그 값을 따른다.
 */
export const COOLDOWN_MS: Record<'rate_limited' | 'unavailable', number> = { rate_limited: 30_000, unavailable: 10_000 }
export const COOLDOWN_JITTER = 0.3

/**
 * 전시용 웹 게스트 토큰. `POST /api/v1/guest/token`(본문 · 인증 없음) → `{ access_token, expires_in }`.
 * 쿠키 · refresh token 이 없어 만료되면 다시 발급받는다.
 */
export function createGuestTokenProvider(deps: GuestTokenDeps): GuestTokenProvider {
  const doFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = deps.now ?? (() => Date.now())
  const random = deps.random ?? Math.random
  const listeners = new Set<(status: GuestStatus) => void>()

  let status: GuestStatus = 'idle'
  let token: string | null = null
  let expiresAt = 0
  let cooldownUntil = 0
  let lastFailure: 'rate_limited' | 'unavailable' = 'unavailable'
  let inflight: Promise<string | null> | null = null
  /** 서버가 토큰을 거부할 때마다 올린다. 거부된 토큰이 미리 갱신 실패 처리에서 되살아나지 않게 한다. */
  let generation = 0
  let renewBeforeMs = RENEW_BEFORE_MS

  const setStatus = (next: GuestStatus) => {
    if (status === next) return
    status = next
    for (const listener of listeners) listener(next)
  }

  const fail = (next: 'rate_limited' | 'unavailable', retryAfterMs?: number): never => {
    token = null
    const base = retryAfterMs ?? COOLDOWN_MS[next]
    cooldownUntil = now() + Math.round(base * (1 - COOLDOWN_JITTER + random() * 2 * COOLDOWN_JITTER))
    lastFailure = next
    setStatus(next)
    throw new GuestTokenError(next)
  }

  async function request(): Promise<string | null> {
    let response: Response
    try {
      response = await doFetch(`${deps.baseUrl}/api/v1/guest/token`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      })
    } catch {
      return fail('unavailable')
    }
    if (response.status === 404) {
      // 계약상 꺼짐(404)은 본문이 없다. 본문이 있는 404 는 프록시 · 배포 중 경로 어긋남으로 보고 일시 장애로 다룬다
      const text = await response.text().catch(() => '')
      if (text.trim()) return fail('unavailable')
      token = null
      setStatus('disabled')
      return null
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      return fail('rate_limited', Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined)
    }
    if (!response.ok) return fail('unavailable')
    let body: { access_token?: unknown; expires_in?: unknown }
    try {
      body = (await response.json()) as typeof body
    } catch {
      return fail('unavailable')
    }
    if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || !(body.expires_in > 0)) {
      return fail('unavailable')
    }
    token = body.access_token
    expiresAt = now() + body.expires_in * 1000
    renewBeforeMs = Math.min(RENEW_BEFORE_MS, (body.expires_in * 1000) / 2)
    setStatus('ready')
    return token
  }

  function issue(): Promise<string | null> {
    if (status === 'disabled') return Promise.resolve(null)
    if (inflight) return inflight
    if (now() < cooldownUntil) return Promise.reject(new GuestTokenError(lastFailure))
    inflight = request().finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    get status() {
      return status
    },
    onStatus(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async getAccessToken() {
      if (token && now() < expiresAt - renewBeforeMs) return token
      // 미리 새로 받으려다 일시 장애면, 아직 만료되지 않은 토큰은 그대로 쓴다(그사이 서버가 거부한 토큰이면 쓰지 않는다)
      const current = token
      const currentExpiresAt = expiresAt
      const currentGeneration = generation
      try {
        return await issue()
      } catch (e) {
        if (current && now() < currentExpiresAt && generation === currentGeneration) {
          token = current
          expiresAt = currentExpiresAt
          // 쓸 수 있는 토큰이 있으니 화면에 연결 장애를 띄우지 않는다
          setStatus('ready')
          return current
        }
        throw e
      }
    },
    async refresh(rejected) {
      // 다른 요청이 이미 거부를 겪고 새로 받아 둔 토큰이 있으면 그것을 쓴다. 여러 요청이 같은 토큰으로 401 을 받아도
      // 한 번만 발급한다(관람객이 한 IP 의 발급 한도를 함께 쓴다)
      if (rejected && token && token !== rejected && now() < expiresAt) return token
      // 서버가 거부한 토큰은 버리고 새로 받는다(진행 중인 미리 갱신이 있으면 합류). 꺼졌으면(404) null — 다시 붙지 않는다
      token = null
      generation += 1
      return issue()
    },
  }
}
