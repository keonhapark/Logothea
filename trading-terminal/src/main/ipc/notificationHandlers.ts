import { IPC_CHANNELS } from '../../lib/ipcChannels'
import { isNotificationPrefs, type NotificationPrefs } from '../../lib/notificationPrefs'
import { IpcError } from '../../lib/types/ipcError'
import { loadNotificationPrefs, saveNotificationPrefs } from '../services/NotificationPreference'
import { NotificationService } from '../services/NotificationService'
import { registerHandler } from './registerHandler'

interface CallStartPayload {
  ticker: string
  companyName: string
  minutesLeft: number
}

function isCallStartPayload(v: unknown): v is CallStartPayload {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.ticker === 'string' &&
    /^[A-Z0-9.\-]{1,10}$/.test(p.ticker) &&
    typeof p.companyName === 'string' &&
    p.companyName.length <= 200 &&
    typeof p.minutesLeft === 'number' &&
    Number.isFinite(p.minutesLeft)
  )
}

/** 알림 설정 읽기 · 바꾸기와 콜 시작 알림 보내기. */
export function registerNotificationHandlers() {
  registerHandler<undefined, NotificationPrefs>(IPC_CHANNELS.SETTINGS_GET_NOTIFICATIONS, () => loadNotificationPrefs())

  registerHandler<NotificationPrefs, { ok: true }>(IPC_CHANNELS.SETTINGS_SET_NOTIFICATIONS, (_e, prefs) => {
    if (!isNotificationPrefs(prefs)) {
      throw new IpcError('VALIDATION', 'notification prefs must be { callStart, callStartLeadMin: 5 | 10 | 30, fills }')
    }
    saveNotificationPrefs({ callStart: prefs.callStart, callStartLeadMin: prefs.callStartLeadMin, fills: prefs.fills })
    return { ok: true }
  })

  registerHandler<CallStartPayload, { ok: true }>(IPC_CHANNELS.NOTIFY_CALL_START, (_e, payload) => {
    if (!isCallStartPayload(payload)) {
      throw new IpcError('VALIDATION', 'call start payload must be { ticker, companyName, minutesLeft }')
    }
    NotificationService.notifyCallStart({
      ticker: payload.ticker,
      companyName: payload.companyName,
      minutesLeft: Math.max(0, Math.round(payload.minutesLeft)),
    })
    return { ok: true }
  })
}
