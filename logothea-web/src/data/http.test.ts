import { describe, expect, it, vi } from 'vitest'
import { IpcError } from '@terminal/lib/types/ipcError'
import { createHttpClient } from './http'
import type { AuthProvider } from './auth'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setup(responses: Array<Response | Error>, auth: Partial<AuthProvider> = {}) {
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('응답 없음')
    if (next instanceof Error) throw next
    return next
  })
  const provider: AuthProvider = {
    getAccessToken: auth.getAccessToken ?? (async () => 'tok'),
    refresh: auth.refresh ?? (async () => null),
  }
  const http = createHttpClient({ baseUrl: 'http://backend', auth: provider, fetch: fetch as unknown as typeof globalThis.fetch })
  return { fetch, http, provider }
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>
}

describe('createHttpClient', () => {
  it('토큰을 Authorization 헤더로 싣고 쿠키는 보내지 않는다', async () => {
    const { fetch, http } = setup([json(200, { ok: true })])
    await expect(http.getJson('/api/v1/glossary')).resolves.toEqual({ ok: true })
    const call = fetch.mock.calls[0] as unknown[]
    expect(call[0]).toBe('http://backend/api/v1/glossary')
    expect(headersOf(call).Authorization).toBe('Bearer tok')
    expect((call[1] as RequestInit).credentials).toBe('omit')
  })

  it('토큰이 없으면 Authorization 을 싣지 않는다', async () => {
    const { fetch, http } = setup([json(200, {})], { getAccessToken: async () => null })
    await http.getJson('/x')
    expect(headersOf(fetch.mock.calls[0] as unknown[]).Authorization).toBeUndefined()
  })

  it('401 이면 토큰을 한 번 갱신해 다시 보낸다', async () => {
    const refresh = vi.fn(async () => 'new')
    const { fetch, http } = setup([json(401, {}), json(200, { ok: 1 })], { refresh })
    await expect(http.getJson('/x')).resolves.toEqual({ ok: 1 })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(headersOf(fetch.mock.calls[1] as unknown[]).Authorization).toBe('Bearer new')
  })

  it('갱신해도 401 이면 다시 갱신하지 않고 AUTH_EXPIRED', async () => {
    const refresh = vi.fn(async () => 'new')
    const { fetch, http } = setup([json(401, {}), json(401, {})], { refresh })
    await expect(http.getJson('/x')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('갱신 결과가 없으면 재시도 없이 AUTH_EXPIRED', async () => {
    const { fetch, http } = setup([json(401, {})])
    await expect(http.getJson('/x')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [403, 'AUTH_REQUIRED'],
    [400, 'VALIDATION'],
    [404, 'VALIDATION'],
    [500, 'BACKEND_5XX'],
    [503, 'BACKEND_5XX'],
  ])('%i → %s (터미널 axiosErrorToIpcError 와 같은 표)', async (status, code) => {
    const { http } = setup([json(status, { error: '서버 메시지' })])
    const error = await http.getJson('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({ code, message: '서버 메시지', details: { status } })
  })

  it('연결 실패는 NETWORK', async () => {
    const { http } = setup([new TypeError('Failed to fetch')])
    await expect(http.getJson('/x')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('request 는 본문을 JSON 으로 보내고 상태와 관계없이 응답을 돌려준다', async () => {
    const { fetch, http } = setup([json(409, { code: 'busy' })])
    const response = await http.request('/y', { method: 'POST', body: { a: 1 }, headers: { Accept: 'text/event-stream' } })
    expect(response.status).toBe(409)
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream')
  })

  it('갱신 요청 자체가 실패(reject)하면 NETWORK 로 본다(세션은 그대로)', async () => {
    const { http } = setup([json(401, {})], {
      refresh: async () => {
        throw new Error('발급 서버 장애')
      },
    })
    await expect(http.getJson('/x')).rejects.toMatchObject({ code: 'NETWORK' })
  })
})
