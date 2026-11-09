import { describe, it, expect, vi, beforeEach } from 'vitest'

const shown: { title: string; body: string; handlers: Record<string, () => void> }[] = []
const send = vi.fn()
const focus = vi.fn()

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return true
    }
    handlers: Record<string, () => void> = {}
    constructor(private opts: { title: string; body: string }) {}
    on(event: string, fn: () => void) {
      this.handlers[event] = fn
    }
    show() {
      shown.push({ ...this.opts, handlers: this.handlers })
    }
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, isMinimized: () => false, restore: vi.fn(), show: vi.fn(), focus, webContents: { send } },
    ],
  },
}))

const prefs = { callStart: true, callStartLeadMin: 10, fills: true }
vi.mock('../NotificationPreference', () => ({ loadNotificationPrefs: () => prefs }))

import { NotificationService } from '../NotificationService'
import { IPC_CHANNELS } from '../../../lib/ipcChannels'

beforeEach(() => {
  shown.length = 0
  send.mockClear()
  focus.mockClear()
  prefs.callStart = true
  prefs.fills = true
})

describe('NotificationService', () => {
  it('체결 알림은 설정이 켜져 있을 때만 보낸다', () => {
    NotificationService.notifyFill({ ticker: 'WMT', executedQty: 3, executedPrice: 97.4 })
    expect(shown).toEqual([expect.objectContaining({ title: '체결 · WMT', body: '3주가 체결되었습니다 · $97.40' })])
    prefs.fills = false
    NotificationService.notifyFill({ ticker: 'WMT', executedQty: 3, executedPrice: null })
    expect(shown).toHaveLength(1)
  })

  it('콜 시작 알림은 설정을 따르고, 누르면 창을 앞으로 가져와 콜 화면을 연다', () => {
    NotificationService.notifyCallStart({ ticker: 'WMT', companyName: 'Walmart Inc.', minutesLeft: 10 })
    expect(shown[0]).toMatchObject({ title: 'WMT 어닝콜', body: 'Walmart Inc. 콜이 10분 뒤 시작합니다.' })
    shown[0].handlers.click()
    expect(focus).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.NOTIFICATION_OPEN_CALL, { ticker: 'WMT' })

    prefs.callStart = false
    NotificationService.notifyCallStart({ ticker: 'WMT', companyName: 'Walmart Inc.', minutesLeft: 0 })
    expect(shown).toHaveLength(1)
  })
})
