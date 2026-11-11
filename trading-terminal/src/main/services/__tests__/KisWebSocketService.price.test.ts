import { describe, it, expect } from 'vitest'
import { parseHdfscnt0 } from '../KisWebSocketService'

/**
 * 해외주식 실시간지연체결가(HDFSCNT0) 필드 순서 — 공식 샘플 examples_user/overseas_stock 의
 * delayed_ccnl 컬럼 정의에 tr_key(RSYM) 를 앞에 붙인 형태.
 *
 * RSYM^SYMB^ZDIV^TYMD^XYMD^XHMS^KYMD^KHMS^OPEN^HIGH^LOW^LAST^SIGN^DIFF^RATE^...
 */
function frame(over: Partial<Record<string, string>> = {}): string {
  const f = [
    over.RSYM ?? 'DNASAAPL',
    over.SYMB ?? 'AAPL',
    over.ZDIV ?? '4',
    '20261111', '20261111', '153000', '20261112', '053000',
    '228.1000', '231.2000', '227.5000',
    over.LAST ?? '230.5000',
    over.SIGN ?? '2',
    over.DIFF ?? '2.5000',
    '1.10', '230.4900', '230.5100', '100', '200', '10', '1234567', '284000000', '600000', '634567', '105.2', '1',
  ]
  return `0|HDFSCNT0|001|${f.join('^')}`
}

describe('parseHdfscnt0', () => {
  it('ZDIV 가 아니라 LAST 를 현재가로 읽는다', () => {
    expect(parseHdfscnt0(frame())).toEqual({ ticker: 'AAPL', price: 230.5, previousClose: 228 })
  })

  it('하락 부호(4·5)면 전일 종가가 현재가보다 높다', () => {
    expect(parseHdfscnt0(frame({ SIGN: '5', DIFF: '1.5' }))?.previousClose).toBeCloseTo(232)
  })

  it('보합(3)이면 전일 종가와 현재가가 같다', () => {
    expect(parseHdfscnt0(frame({ SIGN: '3', DIFF: '0' }))?.previousClose).toBe(230.5)
  })

  it('필드가 모자라면 버린다', () => {
    expect(parseHdfscnt0('0|HDFSCNT0|001|DNASAAPL^AAPL^4^20261111')).toBeNull()
  })

  it('현재가가 0 이하면 버린다', () => {
    expect(parseHdfscnt0(frame({ LAST: '0' }))).toBeNull()
  })

  it('전일 대비를 못 읽으면 전일 종가를 현재가로 둔다', () => {
    expect(parseHdfscnt0(frame({ DIFF: '' }))?.previousClose).toBe(230.5)
  })
})
