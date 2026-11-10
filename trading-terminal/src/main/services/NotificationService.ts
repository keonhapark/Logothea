import { BrowserWindow, Notification } from 'electron'
import { IPC_CHANNELS } from '../../lib/ipcChannels'
import { loadNotificationPrefs } from './NotificationPreference'

export const NotificationService = {
  notifyWsReconnected() {
    show('연결 복구됨', '백엔드 서버에 다시 연결되었습니다.')
  },

  /** 체결 알림. 설정에서 끄면 보내지 않는다. */
  notifyFill(fill: { ticker: string; executedQty: number; executedPrice: number | null }) {
    if (!loadNotificationPrefs().fills) return
    const price = fill.executedPrice != null && Number.isFinite(fill.executedPrice) ? ` · $${fill.executedPrice.toFixed(2)}` : ''
    show(`체결 · ${fill.ticker}`, `${fill.executedQty}주가 체결되었습니다${price}`)
  },

  /**
   * 콜 시작 알림. 언제 보낼지는 renderer 가 관심 · 보유 종목과 일정을 보고 정한다.
   * 누르면 창을 앞으로 가져오고 그 종목의 콜 화면을 연다.
   */
  notifyCallStart(call: { ticker: string; companyName: string; minutesLeft: number }) {
    if (!loadNotificationPrefs().callStart) return
    const when = call.minutesLeft <= 0 ? '곧 시작합니다' : `${call.minutesLeft}분 뒤 시작합니다`
    show(`${call.ticker} 어닝콜`, `${call.companyName} 콜이 ${when}.`, () => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(IPC_CHANNELS.NOTIFICATION_OPEN_CALL, { ticker: call.ticker })
    })
  },
}

// 누르기를 기다리는 알림. 참조를 놓으면 알림이 수거되어 누르기가 오지 않으므로 닫히거나 눌릴 때까지 쥔다.
const pending = new Set<Notification>()

function show(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  if (onClick) {
    pending.add(n)
    n.on('click', () => {
      pending.delete(n)
      onClick()
    })
    n.on('close', () => pending.delete(n))
  }
  n.show()
}
