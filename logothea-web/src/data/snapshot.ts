import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import type { HttpClient } from './http'

/**
 * 중간 입장 스냅샷(Contract 7.8 `GET /api/v1/demo/earnings-call/snapshot?ticker=`).
 *
 * 그 종목의 가장 최근 회차에 발행한 메시지를 한 번에 받아, STOMP 로 받은 것과 같은 `*_RECEIVED` 채널로 흘려 넣는다.
 * 원소가 STOMP 메시지와 같은 모양이라 터미널 store 가 그대로 받고, 겹치는 것은 store 가 버린다
 * (자막 `(callId, sequence)` 단조 검사, 번역 `sequences`, 대조 `sequence:index`, 팩트체크 `claim_id`, 판단은 덮어쓰기).
 *
 * 순서: STOMP 구독 시작 → 실시간 메시지는 잠시 보류 → 스냅샷 적용 → 보류한 메시지 풀기.
 * 자막 store 는 같은 회차에서 마지막 번호 이하를 버리므로, 실시간 메시지가 먼저 들어가면 스냅샷의 앞부분이 모두 버려진다.
 * (재)연결할 때마다 다시 받는다. 화면 잠금 · 망 전환으로 끊긴 사이의 메시지도 이것으로 채운다.
 */

export interface CallSnapshot {
  callId: string | null
  /** 받은 순서대로 흘려 넣을 메시지. 자막 → 번역 → 대조 → 팩트체크 → 판단. */
  messages: { channel: string; payload: unknown }[]
}

const SNAPSHOT_KINDS: ReadonlyArray<{ key: string; channel: string }> = [
  { key: 'segments', channel: IPC_CHANNELS.TRANSCRIPT_SEGMENT_RECEIVED },
  { key: 'translations', channel: IPC_CHANNELS.TRANSCRIPT_TRANSLATION_RECEIVED },
  { key: 'diffs', channel: IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED },
  { key: 'fact_checks', channel: IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED },
]

/** 모양이 틀리면 null. 원소 하나하나의 검증은 store 가 한다. */
export function parseSnapshot(raw: unknown): CallSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const callId = typeof r.call_id === 'string' && r.call_id ? r.call_id : null
  const messages: CallSnapshot['messages'] = []
  for (const { key, channel } of SNAPSHOT_KINDS) {
    const list = r[key]
    if (list === undefined || list === null) continue
    if (!Array.isArray(list)) return null
    for (const payload of list) messages.push({ channel, payload })
  }
  if (r.evaluation !== null && typeof r.evaluation === 'object') {
    messages.push({ channel: IPC_CHANNELS.EVALUATION_RECEIVED, payload: r.evaluation })
  }
  return { callId, messages }
}

export async function fetchSnapshot(http: Pick<HttpClient, 'getJson'>, ticker: string): Promise<CallSnapshot | null> {
  return parseSnapshot(await http.getJson(`/api/v1/demo/earnings-call/snapshot?ticker=${encodeURIComponent(ticker)}`))
}

/** 스냅샷이 이 시간 안에 오지 않으면 보류를 풀고 실시간 메시지만 흘린다. 늦게 온 스냅샷은 버린다. */
export const SNAPSHOT_HOLD_MAX_MS = 8_000

export interface SnapshotSyncDeps {
  fetch: (ticker: string) => Promise<CallSnapshot | null>
  /** 메시지 하나를 store 쪽으로 내보낸다(늦은 회차 거르기 포함). */
  deliver: (channel: string, payload: unknown) => void
  holdMaxMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface SnapshotSync {
  /** 그 종목의 실시간 메시지를 보류하고 스냅샷을 받는다. 받는 중에 다시 부르면 앞의 결과는 버리고 새로 받는다. */
  start(ticker: string): void
  /** 실시간 메시지. 보류 중이면 담아 두고 true, 아니면 false(바로 내보내면 된다). */
  hold(ticker: string, channel: string, payload: unknown): boolean
  /** 구독을 풀었거나 연결을 끊었다. 받는 중인 스냅샷과 보류한 메시지를 버린다. */
  cancel(ticker: string): void
}

export function createSnapshotSync(deps: SnapshotSyncDeps): SnapshotSync {
  const holdMaxMs = deps.holdMaxMs ?? SNAPSHOT_HOLD_MAX_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  interface Pending {
    id: number
    buffer: { channel: string; payload: unknown }[]
    timer: unknown
  }
  const pending = new Map<string, Pending>()
  let nextId = 0

  function deliverAll(messages: readonly { channel: string; payload: unknown }[]) {
    for (const m of messages) {
      try {
        deps.deliver(m.channel, m.payload)
      } catch (e) {
        console.error(`[snapshot] ${m.channel} 내보내기 실패:`, e)
      }
    }
  }

  /** 이 시도가 아직 유효하면 스냅샷(있으면)을 먼저, 보류한 메시지를 뒤에 내보낸다. */
  function finish(ticker: string, id: number, snapshot: CallSnapshot | null) {
    const current = pending.get(ticker)
    if (!current || current.id !== id) return
    pending.delete(ticker)
    clearTimer(current.timer)
    if (snapshot) deliverAll(snapshot.messages)
    deliverAll(current.buffer)
  }

  return {
    start(ticker) {
      const id = ++nextId
      const previous = pending.get(ticker)
      if (previous) clearTimer(previous.timer)
      // 앞 시도가 보류해 둔 메시지는 새 스냅샷 뒤에 함께 푼다
      const entry: Pending = { id, buffer: previous?.buffer ?? [], timer: null }
      entry.timer = setTimer(() => {
        console.warn(`[snapshot] ${ticker} 스냅샷이 늦어 실시간 메시지만 보입니다`)
        finish(ticker, id, null)
      }, holdMaxMs)
      pending.set(ticker, entry)
      // 지금 동기 흐름(STOMP onConnect 의 구독 프레임 전송)이 끝난 뒤에 묻는다. 구독보다 스냅샷이 먼저 만들어지면
      // 그 사이에 발행된 메시지를 어느 쪽에서도 받지 못한다.
      void Promise.resolve()
        .then(() => deps.fetch(ticker))
        .then(
          (snapshot) => finish(ticker, id, snapshot),
          (e) => {
            console.error(`[snapshot] ${ticker} 스냅샷 조회 실패:`, e)
            finish(ticker, id, null)
          },
        )
    },
    cancel(ticker) {
      const entry = pending.get(ticker)
      if (!entry) return
      pending.delete(ticker)
      clearTimer(entry.timer)
    },
    hold(ticker, channel, payload) {
      const entry = pending.get(ticker)
      if (!entry) return false
      entry.buffer.push({ channel, payload })
      return true
    },
  }
}
