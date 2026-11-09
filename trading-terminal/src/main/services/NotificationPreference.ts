import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseNotificationPrefs, type NotificationPrefs } from '../../lib/notificationPrefs'

/**
 * 알림 설정을 기억한다. 체결 알림은 main 이 보내므로 설정의 원본을 main 에 둔다.
 * 비밀 정보가 아니므로 디스크(userData/notifications.json)에 쓴다.
 */

const FILE_NAME = 'notifications.json'

let cached: NotificationPrefs | null = null

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 설정을 읽는다. 파일이 없거나 깨졌으면 기본값이다. 한 번 읽은 뒤에는 기억한 값을 돌려준다. */
export function loadNotificationPrefs(): NotificationPrefs {
  if (cached) return cached
  try {
    cached = parseNotificationPrefs(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch {
    cached = parseNotificationPrefs(undefined)
  }
  return cached
}

/** 동기로 쓴다(ThemePreference 와 같은 이유 — 연달아 바꿀 때 쓰기가 겹치지 않게). */
export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  cached = prefs
  try {
    writeFileSync(filePath(), JSON.stringify(prefs), 'utf8')
  } catch (e) {
    // 기억하지 못해도 이번 실행에는 바뀐 설정이 쓰인다
    console.warn('[NotificationPreference] 알림 설정 저장 실패:', e)
  }
}

export function __resetNotificationPrefsForTest(): void {
  cached = null
}
