import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../lib/ipcChannels'
import { isThemeChoice, type ThemeChoice } from '../../lib/theme'
import { IpcError } from '../../lib/types/ipcError'
import { applyNativeTheme, saveThemeChoice, windowBackground } from '../services/ThemePreference'
import { registerHandler } from './registerHandler'

/**
 * 테마 선택 수신. renderer 가 시작할 때(로그인 전) 저장된 선택을 다시 알리므로 인증을 요구하지 않는다.
 * `system` 일 때 운영체제 설정이 바뀌는 경우의 창 바탕색은 nativeTheme 'updated' 에서 맞춘다(main/index.ts).
 */
export function registerThemeHandlers() {
  registerHandler<ThemeChoice, { ok: true }>(IPC_CHANNELS.SETTINGS_SET_THEME, async (_e, choice) => {
    if (!isThemeChoice(choice)) {
      throw new IpcError('VALIDATION', 'theme must be system | light | dark')
    }
    applyNativeTheme(choice)
    const background = windowBackground()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setBackgroundColor(background)
    }
    saveThemeChoice(choice)
    return { ok: true }
  })
}
