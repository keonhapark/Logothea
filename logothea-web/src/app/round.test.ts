import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { useTranscriptStore } from '@terminal/renderer/store/useTranscriptStore'
import { useTranscriptDiffStore } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useTranscriptTranslationStore } from '@terminal/renderer/store/useTranscriptTranslationStore'
import { useEarningsSummaryStore } from '@terminal/renderer/store/useEarningsSummaryStore'
import { useFactCheckStore } from '@terminal/renderer/store/useFactCheckStore'
import { useCallUi } from './callUi'
import { BROADCAST_TICKER, watchRounds } from './broadcast'
import { clearRetiredCalls, isRetiredPayload } from './callFeed'
import { buildCallData } from '../screens/call/useCallData'
import { createWebIpc } from '../data/webIpc'
import { parseSnapshot, type CallSnapshot } from '../data/snapshot'
import type { StompBridge, WsStatus } from '../data/stomp'

/**
 * 중간 입장 스냅샷 × 실시간 메시지 × 회차 전환을 실제 터미널 store 로 돌린다.
 * STOMP · 스냅샷 응답만 가짜이고, 보류 · 순서 · 중복 제거 · 회차 비우기는 실제 코드다.
 */

const T = BROADCAST_TICKER

const segment = (callId: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  ticker: T, call_id: callId, sequence, start_ms: sequence * 1000, end_ms: sequence * 1000 + 900, text: `${callId}-s${sequence}`, timestamp: sequence, ...extra,
})
const diff = (callId: string, sequence: number, summary: string) => ({
  ticker: T, call_id: callId, sequence,
  previous_document: { document_id: 'p', title: 't', published_at: '', fiscal_quarter: '2026년 1분기', source_url: '' },
  items: [{ topic: 'demand', change_type: 'improved', summary_ko: summary, current_claim: 'a', prior_claim: 'b', confidence: 0.5, risk_score: 0.1, evidence: [] }],
})
const translation = (callId: string, sequences: number[]) => ({ ticker: T, call_id: callId, sequences, text_ko: `${callId}-${sequences.join(',')}`, terms_used: [] })
const factCheck = (callId: string, claimId: string, claim: string) => ({
  ticker: T, call_id: callId, batch_start_sequence: 0, batch_end_sequence: 2,
  claims: [{ claim_id: claimId, claim, verdict: 'SUPPORTED', explanation_ko: claim, confidence: 0.9, evidence: [] }],
})
const evaluation = (callId: string) => ({
  ticker: T, call_id: callId, judgment: { direction: 'BEARISH', magnitude: 0.4, confidence: 0.6 }, gate: { position_intent_ko: `${callId} 판단` },
})

function snapshotBody(callId: string, body: Partial<Record<'segments' | 'translations' | 'diffs' | 'fact_checks', unknown[]>> & { evaluation?: unknown }) {
  return { ticker: T, call_id: callId, running: true, segments: [], translations: [], fact_checks: [], diffs: [], evaluation: null, ...body }
}

function harness(snapshots: unknown[]) {
  const handlers = new Map<string, (body: string) => void>()
  let statusListener: ((s: WsStatus) => void) | null = null
  const stomp = {
    status: 'DISCONNECTED' as WsStatus,
    connect: vi.fn(async () => undefined),
    reconnectNow: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    subscribe: vi.fn((destination: string, handler: (body: string) => void) => void handlers.set(destination, handler)),
    unsubscribe: vi.fn(),
    onStatus: (listener: (s: WsStatus) => void) => {
      statusListener = listener
      return () => undefined
    },
  } satisfies StompBridge
  const queue = [...snapshots]
  const snapshot = vi.fn(async (): Promise<CallSnapshot | null> => parseSnapshot(queue.shift() ?? null))
  const ipc = createWebIpc({
    http: { getJson: vi.fn(async () => null) as never },
    stomp,
    assistant: { ask: vi.fn(), cancel: vi.fn() } as never,
    snapshot,
    dropMessage: (channel, payload) =>
      (channel === IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED || channel === IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED) && isRetiredPayload(payload),
  })
  // BroadcastFeeds 의 터미널 훅이 거는 것과 같은 연결
  ipc.on(IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED, (p) => useTranscriptStore.getState().upsertSegment(p))
  ipc.on(IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED, (p) => useTranscriptDiffStore.getState().upsertDiff(p))
  ipc.on(IPC_CHANNELS.TRANSCRIPT_TRANSLATION_RECEIVED, (p) => useTranscriptTranslationStore.getState().upsertTranslation(p))
  ipc.on(IPC_CHANNELS.EVALUATION_RECEIVED, (p) => useEarningsSummaryStore.getState().setSummary(p))
  ipc.on(IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED, (p) => useFactCheckStore.getState().upsertBatch(p))

  const subscribeAll = async () => {
    for (const channel of [
      IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE,
      IPC_CHANNELS.TRANSCRIPT_TRANSLATION_SUBSCRIBE,
      IPC_CHANNELS.TRANSCRIPT_DIFF_SUBSCRIBE,
      IPC_CHANNELS.EVALUATION_SUBSCRIBE,
      IPC_CHANNELS.FACTCHECK_SUBSCRIBE,
    ]) {
      await ipc.invoke(channel, { ticker: T })
    }
  }
  const connected = () => {
    stomp.status = 'CONNECTED'
    statusListener?.('CONNECTED')
  }
  const push = (topic: string, payload: unknown) => handlers.get(`/topic/${topic}/${T}`)!(JSON.stringify(payload))
  return { subscribeAll, connected, push, snapshot }
}

function view() {
  const t = useTranscriptStore.getState().byTicker.get(T)
  const d = useTranscriptDiffStore.getState().byTicker.get(T)
  return buildCallData({
    segments: t?.segments ?? [],
    endedCallIds: t?.endedCallIds ?? new Set(),
    diffItems: d?.items ?? [],
    previousCall: d?.previousCall ?? null,
    summary: useEarningsSummaryStore.getState().byTicker.get(T) ?? null,
    translations: [],
    glossaryStatus: 'ready',
  })
}

let stopWatching: () => void = () => undefined

beforeEach(() => {
  useTranscriptStore.getState().reset()
  useTranscriptDiffStore.getState().clearTicker(T)
  useTranscriptTranslationStore.getState().clearTicker(T)
  useEarningsSummaryStore.getState().clearTicker(T)
  useFactCheckStore.getState().clearTicker(T)
  useCallUi.setState({ tab: 'transcript', anchorSequence: null, focus: null })
  clearRetiredCalls()
  stopWatching = watchRounds()
})
afterEach(() => stopWatching())

describe('중간 입장 스냅샷', () => {
  it('구독 → 보류 → 스냅샷 → 보류 해제 순서라, 겹친 발언은 한 번만 남고 앞부분이 빠지지 않는다', async () => {
    const h = harness([
      snapshotBody('m1', {
        segments: [segment('m1', 0), segment('m1', 1), segment('m1', 2), segment('m1', 3)],
        translations: [translation('m1', [0, 1])],
        diffs: [diff('m1', 1, '스냅샷 대조')],
      }),
    ])
    await h.subscribeAll()
    h.connected()
    // 스냅샷보다 먼저 온 실시간 메시지 — 하나는 스냅샷과 겹치고 하나는 그 뒤다
    h.push('transcript', segment('m1', 3))
    h.push('transcript', segment('m1', 4))
    h.push('transcript-diff', diff('m1', 4, '실시간 대조'))

    await vi.waitFor(() => expect(useTranscriptStore.getState().byTicker.get(T)?.segments).toHaveLength(5))
    const data = view()
    expect(data.segments.map((s) => s.sequence)).toEqual([0, 1, 2, 3, 4])
    expect(data.diffItems.map((d) => d.summaryKo)).toEqual(['스냅샷 대조', '실시간 대조'])
    expect(data.previousCall?.fiscalQuarter).toBe('2026년 1분기')
    expect(useTranscriptTranslationStore.getState().byTicker.get(T)?.items).toHaveLength(1)
    expect(data.phase).toBe('LIVE')
  })

  it('회차 사이에 들어오면 끝난 회차 전체와 판단을 받아 콜이 끝난 상태로 보인다', async () => {
    const h = harness([
      snapshotBody('m2', {
        segments: [segment('m2', 0), segment('m2', 1, { is_session_end: true })],
        evaluation: evaluation('m2'),
      }),
    ])
    await h.subscribeAll()
    h.connected()
    await vi.waitFor(() => expect(useEarningsSummaryStore.getState().byTicker.get(T)).toBeTruthy())
    const data = view()
    expect(data.phase).toBe('ENDED')
    expect(data.summary?.callId).toBe('m2')
    expect(data.previousSummary).toBeNull()
  })
})

describe('반복 방송 회차 전환 × 스냅샷', () => {
  it('재연결 스냅샷이 새 회차면, 지난 회차를 비운 뒤 새 회차의 대조가 남고 지난 판단은 "지난 회차" 로 간다', async () => {
    const h = harness([
      // 처음 연결: r1 진행 중
      snapshotBody('r1', { segments: [segment('r1', 0), segment('r1', 1)], diffs: [diff('r1', 1, 'r1 대조')] }),
      // 화면 잠금 사이에 r1 이 끝나고 r2 가 시작됐다
      snapshotBody('r2', { segments: [segment('r2', 0), segment('r2', 1)], diffs: [diff('r2', 1, 'r2 대조')] }),
    ])
    await h.subscribeAll()
    h.connected()
    await vi.waitFor(() => expect(view().diffItems).toHaveLength(1))
    h.push('transcript', segment('r1', 2, { is_session_end: true }))
    h.push('evaluation', evaluation('r1'))
    useCallUi.setState({ anchorSequence: 1 })

    h.connected()
    // 보류 중 도착한 지난 회차의 늦은 대조
    h.push('transcript-diff', diff('r1', 2, 'r1 늦은 대조'))
    await vi.waitFor(() => expect(view().callId).toBe('r2'))
    await new Promise((r) => setTimeout(r, 0))

    const data = view()
    expect(data.segments.map((s) => `${s.callId}:${s.sequence}`)).toEqual(['r2:0', 'r2:1'])
    // 대조 store 는 회차를 모르고 `sequence:index` 로 거른다. 비우는 시점이 늦으면 r2 대조가 r1 의 같은 번호로 버려지거나 지워진다
    expect(data.diffItems.map((d) => d.summaryKo)).toEqual(['r2 대조'])
    expect(data.summary).toBeNull()
    expect(data.previousSummary?.callId).toBe('r1')
    expect(data.phase).toBe('LIVE')
    expect(useCallUi.getState().anchorSequence).toBeNull()
    expect(isRetiredPayload({ call_id: 'r1' })).toBe(true)
  })

  it('응답 재사용으로 회차를 넘어 같은 claim_id 가 와도 새 회차 팩트체크가 남고, 지난 회차의 늦은 팩트체크는 버린다', async () => {
    const h = harness([
      snapshotBody('p1', { segments: [segment('p1', 0)], fact_checks: [factCheck('p1', 'k1', 'p1 주장')] }),
      snapshotBody('p2', { segments: [segment('p2', 0)], fact_checks: [factCheck('p2', 'k1', 'p2 주장')] }),
    ])
    await h.subscribeAll()
    h.connected()
    await vi.waitFor(() => expect(useFactCheckStore.getState().byTicker.get(T)?.claims).toHaveLength(1))

    h.connected()
    h.push('factcheck', factCheck('p1', 'k2', 'p1 늦은 주장'))
    await vi.waitFor(() => expect(view().callId).toBe('p2'))
    await new Promise((r) => setTimeout(r, 0))
    expect(useFactCheckStore.getState().byTicker.get(T)?.claims.map((c) => c.claim)).toEqual(['p2 주장'])
  })

  it('실시간으로 새 회차 첫 자막이 오면(스냅샷 없이) 같은 방식으로 비운다', async () => {
    const h = harness([snapshotBody('q1', { segments: [segment('q1', 0, { is_session_end: true })], diffs: [diff('q1', 0, 'q1 대조')] })])
    await h.subscribeAll()
    h.connected()
    await vi.waitFor(() => expect(view().diffItems).toHaveLength(1))

    h.push('transcript', segment('q2', 0))
    h.push('transcript-diff', diff('q2', 0, 'q2 대조'))
    expect(view().diffItems.map((d) => d.summaryKo)).toEqual(['q2 대조'])
  })

  it('처음 본 회차(중간 입장)는 새 회차로 치지 않아 비우지 않는다', async () => {
    useCallUi.setState({ anchorSequence: 2 })
    const h = harness([snapshotBody('f1', { segments: [segment('f1', 0)] })])
    await h.subscribeAll()
    h.connected()
    await vi.waitFor(() => expect(view().segments).toHaveLength(1))
    expect(useCallUi.getState().anchorSequence).toBe(2)
  })
})
