import { describe, expect, it } from 'vitest'
import { parseRoute } from './router'
import { DEFAULT_PREFS, parsePrefs } from './prefs'
import { deriveBroadcastView } from './broadcast'
import { fetchBroadcastStatus, parseBroadcastStatus } from '../data/broadcast'
import { vi } from 'vitest'
import type { TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'

describe('parseRoute', () => {
  it.each([
    ['/', '/'],
    ['/market', '/market'],
    ['/market/', '/market'],
    ['/call', '/call'],
    ['/me', '/me'],
    ['/unknown', '/'],
    ['/market/extra', '/'],
    ['', '/'],
  ])('%s → %s', (path, route) => {
    expect(parseRoute(path)).toBe(route)
  })
})

describe('parsePrefs', () => {
  it('없거나 깨진 값은 기본값(둘 다 켬)', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{깨짐')).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS).toEqual({ showTranslation: true, glossaryUnderline: true })
  })

  it('불리언인 키만 받고 나머지는 기본값', () => {
    expect(parsePrefs('{"showTranslation":false,"glossaryUnderline":"no"}')).toEqual({ showTranslation: false, glossaryUnderline: true })
  })
})

describe('parseBroadcastStatus', () => {
  it('재생 중 · 회차 사이 · 기록 없음을 가른다', () => {
    expect(parseBroadcastStatus({ running: true, ticker: 'WMT', call_id: 'c1' })).toEqual({ kind: 'live', callId: 'c1' })
    expect(parseBroadcastStatus({ running: false, ticker: 'WMT', last_run: { call_id: 'c0', outcome: 'COMPLETED' } })).toEqual({
      kind: 'between',
      callId: 'c0',
    })
    expect(parseBroadcastStatus({ running: false, ticker: 'WMT' })).toEqual({ kind: 'idle' })
  })

  it('모양이 틀리면 null(방송을 모름)', () => {
    expect(parseBroadcastStatus(null)).toBeNull()
    expect(parseBroadcastStatus({ ticker: 'WMT' })).toBeNull()
    expect(parseBroadcastStatus('x')).toBeNull()
  })
})

function seg(callId: string, sequence: number, timestampSec: number): TranscriptSegment {
  return { ticker: 'WMT', callId, sequence, startMs: sequence * 1000, endMs: sequence * 1000 + 900, text: `s${sequence}`, timestamp: timestampSec }
}

describe('deriveBroadcastView', () => {
  const now = 1_000_000_000

  it('상태 API 가 재생 중이면 그 회차 자막만 담아 방송 중', () => {
    const segments = [seg('old', 0, 10), seg('c1', 0, now / 1000 - 5), seg('c1', 1, now / 1000)]
    const view = deriveBroadcastView({ kind: 'live', callId: 'c1' }, segments, new Set(), now)
    expect(view).toMatchObject({ kind: 'live', callId: 'c1' })
    expect(view.kind === 'live' && view.segments.map((s) => s.sequence)).toEqual([0, 1])
  })

  it('상태를 못 읽어도 끝나지 않은 회차의 자막이 최근에 왔으면 방송 중', () => {
    const view = deriveBroadcastView(null, [seg('c1', 0, now / 1000 - 30)], new Set(), now)
    expect(view).toMatchObject({ kind: 'live', callId: 'c1' })
  })

  it('최근 자막이 오래됐거나 끝난 회차면 상태 API 를 따른다', () => {
    const stale = [seg('c1', 0, now / 1000 - 600)]
    expect(deriveBroadcastView(null, stale, new Set(), now)).toEqual({ kind: 'unknown' })
    const ended = [seg('c1', 0, now / 1000 - 5)]
    expect(deriveBroadcastView({ kind: 'between', callId: 'c1' }, ended, new Set(['c1']), now)).toEqual({ kind: 'between', lastCallId: 'c1' })
    expect(deriveBroadcastView({ kind: 'idle' }, [], new Set(), now)).toEqual({ kind: 'idle' })
  })
})

describe('deriveBroadcastView — 회차 전환', () => {
  const now = 1_000_000_000

  it('새 회차가 막 시작돼 아직 자막이 없으면 지난 회차 자막을 붙이지 않는다', () => {
    const segments = [seg('c1', 0, now / 1000 - 5)]
    const view = deriveBroadcastView({ kind: 'live', callId: 'c2' }, segments, new Set(), now)
    expect(view).toMatchObject({ kind: 'live', callId: 'c2' })
    expect(view.kind === 'live' && view.segments).toEqual([])
  })

  it('상태가 회차 사이여도 끝나지 않은 회차의 자막이 막 왔으면 방송 중(상태 폴링 지연 20초 동안)', () => {
    const view = deriveBroadcastView({ kind: 'between', callId: 'c1' }, [seg('c2', 0, now / 1000 - 2)], new Set(), now)
    expect(view).toMatchObject({ kind: 'live', callId: 'c2' })
  })
})

describe('fetchBroadcastStatus', () => {
  it('종목을 인코딩해 상태 경로로 묻는다', async () => {
    const getJson = vi.fn(async () => ({ running: true, call_id: 'c1' }))
    await expect(fetchBroadcastStatus({ getJson } as never, 'BRK.B')).resolves.toEqual({ kind: 'live', callId: 'c1' })
    expect(getJson).toHaveBeenCalledWith('/api/v1/demo/earnings-call/status?ticker=BRK.B')
  })

  it('조회가 실패하면 null(방송을 모름)', async () => {
    const getJson = vi.fn(async () => {
      throw new Error('network')
    })
    await expect(fetchBroadcastStatus({ getJson } as never, 'WMT')).resolves.toBeNull()
  })
})
