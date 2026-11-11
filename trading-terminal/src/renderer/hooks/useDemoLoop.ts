import { useCallback, useEffect, useRef, useState } from 'react'
import { ipc, IPC_CHANNELS } from '../lib/ipc'

/** 반복 방송 상태를 다시 묻는 간격. 서버를 켜고 끄는 일은 드물어 짧을 필요가 없다. */
const POLL_MS = 20_000

interface DemoStatusLike {
  loop?: unknown
}

/** 상태 응답이 반복 방송 중이라고 하는지. 응답이 없거나 모양이 다르면 아니라고 본다. */
export function isLoopStatus(status: unknown): boolean {
  return typeof status === 'object' && status !== null && (status as DemoStatusLike).loop === true
}

interface LoopPollingOptions {
  ticker: string
  /** 상태 조회. 실패하면 null 이나 예외. */
  fetchStatus: (ticker: string) => Promise<unknown>
  /** 받은 반복 여부. 조회에 실패하면 부르지 않는다(마지막 값 유지). */
  onLoop: (loop: boolean) => void
  intervalMs?: number
}

/**
 * 반복 방송 여부를 지금 한 번, 그 뒤 일정 간격으로 묻는다. 멈추는 함수를 돌려준다.
 * 멈춘 뒤에 도착한 응답은 버린다(화면을 떠났거나 종목이 바뀐 뒤).
 */
export function startLoopPolling({ ticker, fetchStatus, onLoop, intervalMs = POLL_MS }: LoopPollingOptions): () => void {
  let alive = true
  const check = async () => {
    try {
      const status = await fetchStatus(ticker)
      if (alive && status !== null && status !== undefined) onLoop(isLoopStatus(status))
    } catch {
      // 일시 실패는 다음 주기에 다시 묻는다
    }
  }
  void check()
  const id = setInterval(() => void check(), intervalMs)
  return () => {
    alive = false
    clearInterval(id)
  }
}

const fetchDemoStatus = (ticker: string) => ipc.invoke<unknown>(IPC_CHANNELS.DEMO_EARNINGS_STATUS, { ticker })

/**
 * 서버가 이 종목의 시연 콜을 반복 방송하는지 (전시용 웹과 같은 방송).
 *
 * 반복 중인 종목은 서버가 시연 시작 · 중지를 409 로 거절한다. 콜 바가 시연 제어 대신 "반복 방송 중" 을 보이도록
 * `enabled`(시연 종목 콜 화면)일 때만 묻는다. 조회에 실패하면 마지막으로 안 값을 그대로 둔다.
 * `markLoop(ticker)` 는 시작이 반복 중이라고 거절됐을 때 다음 조회를 기다리지 않고 표시를 바꾼다.
 * `refresh` 는 지금 다시 물어 반복 여부를 돌려준다(모르면 null).
 */
export function useDemoLoop(ticker: string | null, enabled: boolean) {
  const [loop, setLoop] = useState(false)
  const tickerRef = useRef(ticker)
  tickerRef.current = ticker

  useEffect(() => {
    setLoop(false)
    if (!enabled || !ticker) return
    return startLoopPolling({ ticker, fetchStatus: fetchDemoStatus, onLoop: setLoop })
  }, [ticker, enabled])

  // 요청 중에 화면의 종목이 바뀌었으면 늦게 온 거절을 지금 종목에 붙이지 않는다
  const markLoop = useCallback((t: string) => {
    if (tickerRef.current === t) setLoop(true)
  }, [])

  const refresh = useCallback(async (): Promise<boolean | null> => {
    const t = tickerRef.current
    if (!t) return null
    try {
      const status = await fetchDemoStatus(t)
      if (status === null || status === undefined) return null
      const next = isLoopStatus(status)
      if (tickerRef.current === t) setLoop(next)
      return next
    } catch {
      return null
    }
  }, [])

  return { loop, markLoop, refresh }
}
