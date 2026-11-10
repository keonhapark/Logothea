/**
 * 화면 시각 표기. 관람객 기기의 시간대와 관계없이 한국 시간으로 쓴다(데스크톱 HomePage 와 같음).
 * 좁은 휴대폰 행에 맞게 24시간제 숫자로 쓴다(시안의 `21:00`).
 */

const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DATE_PARTS = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' })
const FULL = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** `21:00` */
export function kstClock(epochSec: number): string {
  return CLOCK.format(new Date(epochSec * 1000))
}

/** `11/14 목 21:00` */
export function kstShortDateTime(epochSec: number): string {
  const parts = DATE_PARTS.formatToParts(new Date(epochSec * 1000))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('weekday')} ${kstClock(epochSec)}`
}

/** `2026년 11월 14일 (목) 21:00` */
export function kstFullDateTime(epochSec: number): string {
  return FULL.format(new Date(epochSec * 1000))
}

/** 콜 시작 기준 ms → `N분째 진행`. 1분 미만이면 `방금 시작`. */
export function elapsedLabel(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  return minutes < 1 ? '방금 시작' : `${minutes}분째 진행`
}

/** 등락률 표기. 상승 `+0.42%`, 하락 `−0.08%`(빼기 기호), 0 은 부호 없이. */
export function signedPercent(pct: number, digits = 2, unit = '%'): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${Math.abs(pct).toFixed(digits)}${unit}`
}

export function priceDirClass(change: number | null | undefined): '' | 'up' | 'down' {
  if (change == null || change === 0 || !Number.isFinite(change)) return ''
  return change > 0 ? 'up' : 'down'
}
