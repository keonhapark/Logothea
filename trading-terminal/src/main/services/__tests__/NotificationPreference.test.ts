import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// setup.ts 의 electron mock(app.getPath)을 쓴다.
import { __resetNotificationPrefsForTest, loadNotificationPrefs, saveNotificationPrefs } from '../NotificationPreference'
import { DEFAULT_NOTIFICATION_PREFS } from '../../../lib/notificationPrefs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notify-pref-'))
  vi.mocked(app.getPath).mockReturnValue(dir)
  __resetNotificationPrefsForTest()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('NotificationPreference', () => {
  it('파일이 없으면 기본값이다', () => {
    expect(loadNotificationPrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('저장한 설정을 다음 실행에 읽는다', () => {
    saveNotificationPrefs({ callStart: false, callStartLeadMin: 30, fills: false })
    expect(JSON.parse(readFileSync(join(dir, 'notifications.json'), 'utf8'))).toEqual({ callStart: false, callStartLeadMin: 30, fills: false })
    __resetNotificationPrefsForTest()
    expect(loadNotificationPrefs()).toEqual({ callStart: false, callStartLeadMin: 30, fills: false })
  })

  it('파일이 깨졌으면 기본값이다', () => {
    writeFileSync(join(dir, 'notifications.json'), '{not json')
    expect(loadNotificationPrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
})
