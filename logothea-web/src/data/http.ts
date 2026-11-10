import { IpcError, type IpcErrorCode } from '@terminal/lib/types/ipcError'
import type { AuthProvider } from './auth'

/**
 * 백엔드 REST 호출. 터미널 BackendClient(axios)의 규칙을 브라우저 fetch 로 옮긴 것이다.
 *
 * - 토큰을 Authorization 헤더로 싣는다. 쿠키는 보내지 않는다(credentials: 'omit').
 * - 401 이면 토큰을 한 번 갱신해 다시 보낸다. 갱신 결과가 없으면 401 응답을 그대로 돌려준다.
 * - 토큰을 받지 못한 일시 장애(getAccessToken reject)여도 요청은 토큰 없이 보낸다. 401 이면 그 장애를 던진다.
 * - 실패는 터미널과 같은 IpcError 코드로 바꾼다. 터미널 store 가 그 코드로 분기하기 때문이다
 *   (예: 용어 사전은 AUTH_EXPIRED 만 다르게 다룬다).
 */

export interface HttpDeps {
  baseUrl: string
  auth: AuthProvider
  fetch?: typeof fetch
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface HttpClient {
  /** 응답 상태와 관계없이 Response 를 돌려준다(401 갱신 재시도는 거친 뒤). 네트워크 실패만 throw. */
  request(path: string, options?: RequestOptions): Promise<Response>
  /** 2xx 면 JSON 본문, 아니면 IpcError 로 reject. */
  getJson<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>
}

export function createHttpClient(deps: HttpDeps): HttpClient {
  const doFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    return doFetch(deps.baseUrl + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
    })
  }

  async function request(path: string, options: RequestOptions = {}): Promise<Response> {
    // 토큰을 받지 못해도(게스트 발급 장애) 인증이 필요 없는 경로(지수 · 종목 목록 · 시세)는 토큰 없이 보낸다.
    // 인증이 필요한 경로라 401 이 오면 그때 토큰 장애를 그대로 알린다(NETWORK).
    let token: string | null = null
    let tokenError: unknown = null
    try {
      token = await deps.auth.getAccessToken()
    } catch (e) {
      tokenError = e
    }
    const response = await send(path, options, token)
    if (response.status !== 401) return response
    if (tokenError) throw tokenError
    const refreshed = await deps.auth.refresh(token)
    if (!refreshed || options.signal?.aborted) return response
    return send(path, options, refreshed)
  }

  return {
    request,
    async getJson<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
      let response: Response
      try {
        response = await request(path, { ...options, method: 'GET' })
      } catch (e) {
        throw networkError(e)
      }
      if (!response.ok) throw await httpError(response)
      return (await response.json()) as T
    },
  }
}

export function networkError(e: unknown): IpcError {
  return new IpcError('NETWORK', '서버에 연결하지 못했습니다.', { cause: e instanceof Error ? e.message : String(e) })
}

/** HTTP 상태 → IpcError. 터미널 `axiosErrorToIpcError` 와 같은 표를 쓴다. */
export async function httpError(response: Response): Promise<IpcError> {
  const body = await readJsonObject(response)
  const backendMessage = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : null
  const status = response.status
  const details = { status }
  const [code, fallback] = classifyStatus(status)
  return new IpcError(code, backendMessage ?? fallback, details)
}

function classifyStatus(status: number): [IpcErrorCode, string] {
  if (status === 401 || status === 419) return ['AUTH_EXPIRED', '인증이 만료되었습니다.']
  if (status === 403) return ['AUTH_REQUIRED', '접근 권한이 없습니다.']
  if (status >= 500) return ['BACKEND_5XX', '서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.']
  if (status >= 400) return ['VALIDATION', '요청이 잘못되었습니다.']
  return ['UNKNOWN', `HTTP ${status}`]
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
