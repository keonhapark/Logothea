import { create } from 'zustand'
import { ipc, IPC_CHANNELS } from '../lib/ipc'
import { DEFAULT_NOTIFICATION_PREFS, parseNotificationPrefs, type NotificationPrefs } from '../../lib/notificationPrefs'
import { showIpcErrorToast } from '../components/common/Toast'

interface NotificationPrefsState {
  prefs: NotificationPrefs
  loaded: boolean
  /** 읽기에 실패했다. 기본값으로 덮어쓰지 않도록 설정 화면은 바꾸지 못하게 둔다. */
  failed: boolean
  /** main 에 기억한 설정을 읽는다. */
  load: () => Promise<void>
  /** 바로 화면에 반영하고 main 에 저장한다. 저장에 실패하면 되돌린다. */
  update: (patch: Partial<NotificationPrefs>) => Promise<void>
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  loaded: false,
  failed: false,

  load: async () => {
    try {
      const prefs = parseNotificationPrefs(await ipc.invoke(IPC_CHANNELS.SETTINGS_GET_NOTIFICATIONS))
      set({ prefs, loaded: true, failed: false })
    } catch {
      set({ failed: true })
    }
  },

  update: async (patch) => {
    // 읽기 전에 저장하면 기억한 값이 기본값으로 덮인다
    if (!get().loaded) return
    const previous = get().prefs
    const next = { ...previous, ...patch }
    set({ prefs: next })
    try {
      await ipc.invoke(IPC_CHANNELS.SETTINGS_SET_NOTIFICATIONS, next)
    } catch (e) {
      // 그사이 다른 변경이 없을 때만 되돌린다
      if (get().prefs === next) set({ prefs: previous })
      showIpcErrorToast(e)
    }
  },
}))
