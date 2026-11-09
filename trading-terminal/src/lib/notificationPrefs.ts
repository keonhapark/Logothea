/**
 * 알림 설정 — 콜 시작 알림과 체결 알림을 켜고 끈다. main(체결 알림 · 저장)과 renderer(콜 시작 알림 · 설정 화면)가 함께 쓴다.
 */

/** 콜 시작 몇 분 전에 알릴지. */
export const CALL_START_LEAD_OPTIONS = [5, 10, 30] as const
export type CallStartLeadMin = (typeof CALL_START_LEAD_OPTIONS)[number]

export interface NotificationPrefs {
  /** 관심 · 보유 종목의 콜이 시작되기 전에 알린다. */
  callStart: boolean
  callStartLeadMin: CallStartLeadMin
  /** 보낸 주문이 체결되면 알린다(KIS 체결통보). */
  fills: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  callStart: true,
  callStartLeadMin: 10,
  fills: true,
}

function isLead(value: unknown): value is CallStartLeadMin {
  return CALL_START_LEAD_OPTIONS.includes(value as CallStartLeadMin)
}

/** 저장된 값이나 IPC 로 받은 값을 읽는다. 항목마다 잘못된 값은 기본값으로 둔다. */
export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    callStart: typeof v.callStart === 'boolean' ? v.callStart : DEFAULT_NOTIFICATION_PREFS.callStart,
    callStartLeadMin: isLead(v.callStartLeadMin) ? v.callStartLeadMin : DEFAULT_NOTIFICATION_PREFS.callStartLeadMin,
    fills: typeof v.fills === 'boolean' ? v.fills : DEFAULT_NOTIFICATION_PREFS.fills,
  }
}

/** IPC 로 받은 값이 온전한 설정인지. 설정 저장은 일부만 맞는 값을 받지 않는다. */
export function isNotificationPrefs(value: unknown): value is NotificationPrefs {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.callStart === 'boolean' && isLead(v.callStartLeadMin) && typeof v.fills === 'boolean'
}
