import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow, ipcMain, nativeTheme } from 'electron'

// setup.ts 의 electron mock 을 쓴다. 파일 저장은 여기서 확인하지 않는다(ThemePreference.test.ts).
vi.mock('../../services/ThemePreference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ThemePreference')>()
  return { ...actual, saveThemeChoice: vi.fn(() => undefined) }
})

import { registerThemeHandlers } from '../themeHandlers'
import { saveThemeChoice } from '../../services/ThemePreference'
import { IPC_CHANNELS } from '../../../lib/ipcChannels'
import { expectIpcError } from '../../../test/ipcErrorTestUtils'

type IpcInvokeHandler = (event: unknown, payload: unknown) => Promise<unknown>

function getHandler(): IpcInvokeHandler {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  const call = handleMock.mock.calls.find((c) => c[0] === IPC_CHANNELS.SETTINGS_SET_THEME)
  if (!call) throw new Error('set-theme 미등록')
  return call[1] as IpcInvokeHandler
}

beforeEach(() => {
  ;(ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mockClear()
  ;(nativeTheme as { themeSource: string }).themeSource = 'system'
})

describe('themeHandlers — 테마 선택 수신', () => {
  it('창 테마 · 창 바탕색을 맞추고 선택을 기억한다', async () => {
    const win = { isDestroyed: () => false, setBackgroundColor: vi.fn() }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never)
    registerThemeHandlers()

    await expect(getHandler()({}, 'light')).resolves.toEqual({ ok: true })

    expect(nativeTheme.themeSource).toBe('light')
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(1)
    expect(saveThemeChoice).toHaveBeenCalledWith('light')
  })

  it('세 값이 아니면 거부하고 아무것도 바꾸지 않는다', async () => {
    registerThemeHandlers()

    await expectIpcError(getHandler()({}, 'sepia'), 'VALIDATION')
    await expectIpcError(getHandler()({}, undefined), 'VALIDATION')

    expect(nativeTheme.themeSource).toBe('system')
    expect(saveThemeChoice).not.toHaveBeenCalled()
  })
})
