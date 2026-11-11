import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { createSnapshotSync, fetchSnapshot, parseSnapshot, type CallSnapshot } from './snapshot'

const segment = (sequence: number, callId = 'c1') => ({
  ticker: 'WMT', call_id: callId, sequence, start_ms: sequence * 1000, end_ms: sequence * 1000 + 900, text: `s${sequence}`, timestamp: sequence,
})

describe('parseSnapshot', () => {
  it('종류마다 STOMP 와 같은 채널로, 자막 → 번역 → 대조 → 팩트체크 → 판단 순서로 편다', () => {
    const snap = parseSnapshot({
      ticker: 'WMT',
      call_id: 'c1',
      running: false,
      segments: [segment(0), segment(1)],
      translations: [{ call_id: 'c1', sequences: [0, 1] }],
      fact_checks: [{ call_id: 'c1', claim_id: 'k' }],
      diffs: [{ call_id: 'c1', sequence: 1 }],
      evaluation: { call_id: 'c1' },
    })
    expect(snap?.callId).toBe('c1')
    expect(snap?.messages.map((m) => m.channel)).toEqual([
      IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED,
      IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED,
      IPC_CHANNELS.TRANSCRIPT_TRANSLATION_RECEIVED,
      IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED,
      IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED,
      IPC_CHANNELS.EVALUATION_RECEIVED,
    ])
  })

  it('기록이 없으면(call_id null · 빈 목록) 메시지가 없다', () => {
    const snap = parseSnapshot({ ticker: 'WMT', call_id: null, running: false, segments: [], translations: [], fact_checks: [], diffs: [], evaluation: null })
    expect(snap).toEqual({ callId: null, messages: [] })
  })

  it('목록 자리에 배열이 아닌 값이 오면 통째로 버린다(null)', () => {
    expect(parseSnapshot({ call_id: 'c1', segments: 'x' })).toBeNull()
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('x')).toBeNull()
  })

  it('종목을 인코딩해 스냅샷 경로로 묻는다', async () => {
    const getJson = vi.fn(async () => ({ call_id: null }))
    await fetchSnapshot({ getJson } as never, 'BRK.B')
    expect(getJson).toHaveBeenCalledWith('/api/v1/demo/earnings-call/snapshot?ticker=BRK.B')
  })
})

/** 타이머를 손으로 돌린다. */
function manualTimers() {
  const timers = new Map<number, () => void>()
  let id = 0
  return {
    setTimer: (fn: () => void) => {
      timers.set(++id, fn)
      return id
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    fireAll: () => {
      const fns = [...timers.values()]
      timers.clear()
      fns.forEach((fn) => fn())
    },
    get size() {
      return timers.size
    },
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const snap = (...sequences: number[]): CallSnapshot => ({
  callId: 'c1',
  messages: sequences.map((s) => ({ channel: 'seg', payload: s })),
})

describe('createSnapshotSync', () => {
  function setup(fetch: (ticker: string) => Promise<CallSnapshot | null>) {
    const delivered: unknown[] = []
    const timers = manualTimers()
    const sync = createSnapshotSync({ fetch, deliver: (_c, p) => delivered.push(p), setTimer: timers.setTimer, clearTimer: timers.clearTimer, holdMaxMs: 8000 })
    return { sync, delivered, timers }
  }

  it('보류 중 온 실시간 메시지는 스냅샷 뒤에 도착 순서대로 푼다', async () => {
    const d = deferred<CallSnapshot | null>()
    const { sync, delivered, timers } = setup(() => d.promise)
    sync.start('WMT')
    expect(sync.hold('WMT', 'seg', 3)).toBe(true)
    expect(sync.hold('WMT', 'seg', 4)).toBe(true)
    expect(delivered).toEqual([])

    d.resolve(snap(0, 1, 2, 3))
    await vi.waitFor(() => expect(delivered).toEqual([0, 1, 2, 3, 3, 4]))
    expect(timers.size).toBe(0)
    // 풀린 뒤에는 보류하지 않는다
    expect(sync.hold('WMT', 'seg', 5)).toBe(false)
  })

  it('다른 종목은 보류하지 않는다', () => {
    const { sync } = setup(() => new Promise(() => undefined))
    sync.start('WMT')
    expect(sync.hold('AAPL', 'seg', 1)).toBe(false)
  })

  it('지금 동기 흐름이 끝난 뒤에 묻는다(구독 프레임이 먼저 나가게)', async () => {
    const fetch = vi.fn(async () => null)
    const { sync } = setup(fetch)
    sync.start('WMT')
    expect(fetch).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledWith('WMT')
  })

  it('스냅샷 조회가 실패하면 보류한 메시지만 푼다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { sync, delivered } = setup(async () => {
      throw new Error('403')
    })
    sync.start('WMT')
    sync.hold('WMT', 'seg', 7)
    await vi.waitFor(() => expect(delivered).toEqual([7]))
    expect(error).toHaveBeenCalled()
  })

  it('스냅샷이 늦으면 보류를 풀고, 그 뒤에 온 스냅샷은 버린다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = deferred<CallSnapshot | null>()
    const { sync, delivered, timers } = setup(() => d.promise)
    sync.start('WMT')
    sync.hold('WMT', 'seg', 9)
    timers.fireAll()
    expect(delivered).toEqual([9])

    d.resolve(snap(0, 1))
    await new Promise((r) => setTimeout(r, 0))
    expect(delivered).toEqual([9])
  })

  it('받는 중에 다시 시작하면(재연결) 앞 결과는 버리고, 보류한 메시지는 새 스냅샷 뒤에 함께 푼다', async () => {
    const first = deferred<CallSnapshot | null>()
    const second = deferred<CallSnapshot | null>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { sync, delivered, timers } = setup(fetch)
    sync.start('WMT')
    sync.hold('WMT', 'seg', 'a')
    sync.start('WMT')
    sync.hold('WMT', 'seg', 'b')
    expect(timers.size).toBe(1)

    first.resolve(snap(0))
    await new Promise((r) => setTimeout(r, 0))
    expect(delivered).toEqual([])

    second.resolve(snap(0, 1))
    await vi.waitFor(() => expect(delivered).toEqual([0, 1, 'a', 'b']))
  })

  it('취소하면 받는 중인 스냅샷과 보류한 메시지를 버리고 더 보류하지 않는다', async () => {
    const d = deferred<CallSnapshot | null>()
    const { sync, delivered, timers } = setup(() => d.promise)
    sync.start('WMT')
    sync.hold('WMT', 'seg', 5)
    sync.cancel('WMT')
    expect(timers.size).toBe(0)
    expect(sync.hold('WMT', 'seg', 6)).toBe(false)
    d.resolve(snap(0))
    await new Promise((r) => setTimeout(r, 0))
    expect(delivered).toEqual([])
  })

  it('메시지 하나를 내보내다 오류가 나도 나머지는 내보낸다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const delivered: unknown[] = []
    const sync = createSnapshotSync({
      fetch: async () => snap(0, 1, 2),
      deliver: (_c, p) => {
        if (p === 1) throw new Error('boom')
        delivered.push(p)
      },
    })
    sync.start('WMT')
    await vi.waitFor(() => expect(delivered).toEqual([0, 2]))
  })
})
