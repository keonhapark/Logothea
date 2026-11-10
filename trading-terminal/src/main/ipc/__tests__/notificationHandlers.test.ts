import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('../../services/NotificationPreference', () => ({
  loadNotificationPrefs: vi.fn(() => ({ callStart: true, callStartLeadMin: 10, fills: true })),
  saveNotificationPrefs: vi.fn(),
}))
vi.mock('../../services/NotificationService', () => ({
  NotificationService: { notifyCallStart: vi.fn() },
}))

import { registerNotificationHandlers } from '../notificationHandlers'
import { saveNotificationPrefs } from '../../services/NotificationPreference'
import { NotificationService } from '../../services/NotificationService'
import { IPC_CHANNELS } from '../../../lib/ipcChannels'
import { expectIpcError } from '../../../test/ipcErrorTestUtils'

type IpcInvokeHandler = (event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): IpcInvokeHandler {
  const call = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`${channel} 미등록`)
  return call[1] as IpcInvokeHandler
}

beforeEach(() => {
  ;(ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mockClear()
  vi.mocked(saveNotificationPrefs).mockClear()
  vi.mocked(NotificationService.notifyCallStart).mockClear()
  registerNotificationHandlers()
})

describe('notificationHandlers', () => {
  it('설정을 읽는다', async () => {
    await expect(getHandler(IPC_CHANNELS.SETTINGS_GET_NOTIFICATIONS)({}, undefined)).resolves.toEqual({
      callStart: true,
      callStartLeadMin: 10,
      fills: true,
    })
  })

  it('온전한 설정만 저장하고 다른 필드는 버린다', async () => {
    const set = getHandler(IPC_CHANNELS.SETTINGS_SET_NOTIFICATIONS)
    await expect(set({}, { callStart: false, callStartLeadMin: 5, fills: true, extra: 1 })).resolves.toEqual({ ok: true })
    expect(saveNotificationPrefs).toHaveBeenCalledWith({ callStart: false, callStartLeadMin: 5, fills: true })
    await expectIpcError(set({}, { callStart: false, callStartLeadMin: 7, fills: true }), 'VALIDATION')
    expect(saveNotificationPrefs).toHaveBeenCalledTimes(1)
  })

  it('콜 시작 알림 요청을 검증해 넘긴다', async () => {
    const notify = getHandler(IPC_CHANNELS.NOTIFY_CALL_START)
    await notify({}, { ticker: 'WMT', companyName: 'Walmart Inc.', minutesLeft: 9.6 })
    expect(NotificationService.notifyCallStart).toHaveBeenCalledWith({ ticker: 'WMT', companyName: 'Walmart Inc.', minutesLeft: 10 })
    await expectIpcError(notify({}, { ticker: 'wmt<script>', companyName: 'x', minutesLeft: 1 }), 'VALIDATION')
    await expectIpcError(notify({}, { ticker: 'WMT', companyName: 'x', minutesLeft: Number.NaN }), 'VALIDATION')
  })
})
