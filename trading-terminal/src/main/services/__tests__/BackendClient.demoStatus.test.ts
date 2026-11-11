import { describe, it, expect, beforeEach } from 'vitest'

// 공유 axios mock — setup.ts 에서 vi.mock('axios') 등록.
import { kisHttpMock } from '../../../test/setup'
import { BackendClient } from '../BackendClient'

beforeEach(() => {
  kisHttpMock.get.mockReset()
  kisHttpMock.post.mockReset()
})

/** Backend Contract 7.8 — GET /api/v1/demo/earnings-call/status (반복 방송 여부 loop 포함). */
describe('BackendClient.getEarningsDemoStatus', () => {
  it('반복 방송 중인 응답을 화면용 모양으로 바꾼다', async () => {
    kisHttpMock.get.mockResolvedValueOnce({
      data: { running: true, ticker: 'WMT', call_id: 'demo-wmt-1', published_count: 5, total_segments: 24, loop: true },
    })
    const result = await BackendClient.getEarningsDemoStatus('WMT')
    expect(result).toEqual({ running: true, ticker: 'WMT', callId: 'demo-wmt-1', loop: true })
    // 서버는 ticker 를 필수로 받는다. 빠지면 400 이라 반복 여부를 끝내 모른다.
    expect(kisHttpMock.get).toHaveBeenCalledWith('/api/v1/demo/earnings-call/status', { params: { ticker: 'WMT' } })
  })

  it('loop 가 없는 이전 서버 응답은 반복 아님으로 본다', async () => {
    kisHttpMock.get.mockResolvedValueOnce({ data: { running: false, ticker: null, call_id: null } })
    const result = await BackendClient.getEarningsDemoStatus('WMT')
    expect(result).toEqual({ running: false, ticker: null, callId: null, loop: false })
  })

  it('조회 실패는 null', async () => {
    kisHttpMock.get.mockRejectedValueOnce(new Error('network'))
    expect(await BackendClient.getEarningsDemoStatus('WMT')).toBeNull()
  })
})

describe('BackendClient.startEarningsDemo — 409 구분', () => {
  const conflict = (data: object) => Object.assign(new Error('409'), { response: { status: 409, data } })

  it('반복 방송 중(code loop_running)이면 LOOP_RUNNING', async () => {
    kisHttpMock.post.mockRejectedValueOnce(
      conflict({ error: '반복 방송 중인 종목이라 시작 · 중지할 수 없습니다.', code: 'loop_running', ticker: 'WMT' }),
    )
    const result = await BackendClient.startEarningsDemo('WMT')
    expect(result).toEqual({ ok: false, reason: 'LOOP_RUNNING', message: '반복 방송 중인 종목이라 시작 · 중지할 수 없습니다.' })
  })

  it('그 밖의 409 는 지금처럼 ALREADY_RUNNING', async () => {
    kisHttpMock.post.mockRejectedValueOnce(conflict({ error: '이미 재생 중입니다.' }))
    const result = await BackendClient.startEarningsDemo('WMT')
    expect(result).toMatchObject({ ok: false, reason: 'ALREADY_RUNNING' })
  })
})
