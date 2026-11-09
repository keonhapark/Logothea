import { describe, it, expect } from 'vitest'
import { DEFAULT_NOTIFICATION_PREFS, isNotificationPrefs, parseNotificationPrefs } from '../notificationPrefs'

describe('parseNotificationPrefs', () => {
  it('값이 없거나 깨졌으면 기본값이다', () => {
    expect(parseNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(parseNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(parseNotificationPrefs('on')).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('항목마다 잘못된 값만 기본값으로 둔다', () => {
    expect(parseNotificationPrefs({ callStart: false, callStartLeadMin: 7, fills: 'yes' })).toEqual({
      callStart: false,
      callStartLeadMin: DEFAULT_NOTIFICATION_PREFS.callStartLeadMin,
      fills: DEFAULT_NOTIFICATION_PREFS.fills,
    })
    expect(parseNotificationPrefs({ callStart: true, callStartLeadMin: 30, fills: false })).toEqual({
      callStart: true,
      callStartLeadMin: 30,
      fills: false,
    })
  })
})

describe('isNotificationPrefs', () => {
  it('온전한 값만 받는다', () => {
    expect(isNotificationPrefs({ callStart: true, callStartLeadMin: 5, fills: false })).toBe(true)
    expect(isNotificationPrefs({ callStart: true, callStartLeadMin: 15, fills: false })).toBe(false)
    expect(isNotificationPrefs({ callStart: true, fills: false })).toBe(false)
    expect(isNotificationPrefs(null)).toBe(false)
  })
})
