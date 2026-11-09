import { useEffect, useMemo, useState } from 'react'
import { ipc, IPC_CHANNELS } from '../lib/ipc'
import { planCallStartAlerts } from '../lib/callStartAlerts'
import { useWatchlistStore } from '../store/useWatchlistStore'
import { usePortfolioStore } from '../store/usePortfolioStore'
import { useNotificationPrefsStore } from '../store/useNotificationPrefsStore'
import type { EarningsTimelineData } from '../../lib/types/earningsTimeline'

// 이번 실행에서 알린 콜. 일정이 다시 와서 타이머를 새로 걸어도 같은 콜을 또 알리지 않는다.
const notified = new Set<string>()

/**
 * 관심 · 보유 종목의 콜이 시작되기 전에 알린다(설정의 콜 시작 알림).
 *
 * 일정은 main 이 로그인 뒤 5분마다 보내 주는 것(EARNINGS_TIMELINE_UPDATE)을 쓴다. 알림 자체는 main 이
 * 운영체제 알림으로 띄우고, 누르면 NOTIFICATION_OPEN_CALL 로 돌아와 콜 화면을 연다(App.tsx).
 */
export function useCallStartAlerts(enabled: boolean): void {
  const [timeline, setTimeline] = useState<EarningsTimelineData | null>(null)
  const watchlist = useWatchlistStore((s) => s.items)
  const holdings = usePortfolioStore((s) => s.holdings)
  const prefs = useNotificationPrefsStore((s) => s.prefs)
  // 설정을 읽지 못했으면 기본값으로 시간을 잡는다. 꺼 두었다면 main 이 기억한 설정으로 알림을 버린다.
  const ready = useNotificationPrefsStore((s) => s.loaded || s.failed)

  useEffect(() => {
    if (!enabled) return
    if (!useNotificationPrefsStore.getState().loaded) void useNotificationPrefsStore.getState().load()
    let cancelled = false
    // 로그인 직후 main 이 처음 보내는 일정은 이 구독보다 먼저 올 수 있어 한 번 직접 받는다
    ipc
      .invoke<EarningsTimelineData>(IPC_CHANNELS.EARNINGS_TIMELINE_GET)
      .then((d) => {
        if (!cancelled) setTimeline(d)
      })
      .catch(() => {})
    const off = ipc.on(IPC_CHANNELS.EARNINGS_TIMELINE_UPDATE, (d) => setTimeline(d as EarningsTimelineData))
    return () => {
      cancelled = true
      off()
      // 다음 로그인에서 이전 일정으로 타이머를 걸지 않게 비운다
      setTimeline(null)
    }
  }, [enabled])

  // 종목 목록이 같으면 타이머를 다시 걸지 않도록 글자로 묶는다
  const watchedKey = useMemo(
    () => [...new Set([...watchlist.map((w) => w.ticker), ...holdings.filter((h) => h.qty > 0).map((h) => h.ticker)])].sort().join(','),
    [watchlist, holdings],
  )

  useEffect(() => {
    if (!enabled || !ready || !prefs.callStart || !timeline || watchedKey === '') return
    const watched = new Set(watchedKey.split(','))
    const alerts = planCallStartAlerts(timeline, watched, prefs.callStartLeadMin, Date.now(), notified)
    const timers = alerts.map((a) =>
      setTimeout(() => {
        // 잠자기에서 깨어나 늦게 돌면 이미 시작한 콜일 수 있다
        if (a.scheduledAt * 1000 <= Date.now()) return
        notified.add(a.key)
        const minutesLeft = Math.max(0, Math.round((a.scheduledAt * 1000 - Date.now()) / 60_000))
        ipc.invoke(IPC_CHANNELS.NOTIFY_CALL_START, { ticker: a.ticker, companyName: a.companyName, minutesLeft }).catch(() => {
          // 알림을 못 띄워도 앱 사용에는 지장이 없다
        })
      }, a.delayMs),
    )
    return () => timers.forEach(clearTimeout)
  }, [enabled, ready, prefs.callStart, prefs.callStartLeadMin, timeline, watchedKey])
}
