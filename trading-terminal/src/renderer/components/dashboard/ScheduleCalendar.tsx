import { useMemo, useState } from 'react'
import type { EarningsEvent, EarningsGroup } from '../../../lib/types/earningsTimeline'

type MineTag = '보유' | '관심'

interface ScheduleCalendarProps {
  groups: readonly EarningsGroup[]
  tags: ReadonlyMap<string, MineTag>
  onPick: (ticker: string) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

const CLOCK = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: 'numeric',
  minute: '2-digit',
})

function formatClock(sec: number): string {
  return CLOCK.format(new Date(sec * 1000))
}

export function toKstDateKey(sec: number): string {
  // en-CA format returns YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(sec * 1000))
}

export function getTodayKstKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export function formatKstDateHeader(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dayName = WEEKDAYS[date.getUTCDay()]
  return `${m}월 ${d}일 (${dayName})`
}

export function computeMonthGrid(viewYear: number, viewMonth: number) {
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay()
  const lastDate = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate()
  const prevLastDate = new Date(Date.UTC(viewYear, viewMonth - 1, 0)).getUTCDate()

  const trailing: number[] = []
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    trailing.push(prevLastDate - i)
  }

  const current: number[] = []
  for (let d = 1; d <= lastDate; d++) {
    current.push(d)
  }

  return { prevTrailingDays: trailing, currentMonthDays: current }
}

/**
 * 어닝콜 캘린더 — 월간 달력 격자와 일자별 어닝콜 목록 연동 뷰.
 *
 * 실적 발표가 있는 날짜 셀 아래에 점(관심·보유 종목은 금색 점)을 표시하고,
 * 날짜를 선택하면 해당 일자의 어닝콜 카드가 우측에 나타납니다.
 */
export default function ScheduleCalendar({ groups, tags, onPick }: ScheduleCalendarProps) {
  const todayKey = useMemo(() => getTodayKstKey(), [])
  const [todayYear, todayMonth] = useMemo(() => todayKey.split('-').map(Number), [todayKey])

  // 전체 이벤트를 날짜별(YYYY-MM-DD in KST)로 묶는다
  const eventsByDate = useMemo(() => {
    const map = new Map<string, EarningsEvent[]>()
    for (const g of groups) {
      for (const e of g.events) {
        const key = toKstDateKey(e.scheduledAt)
        const list = map.get(key) ?? []
        list.push(e)
        map.set(key, list)
      }
    }
    // 각 날짜 내에서는 발표 시각 순으로 정렬
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduledAt - b.scheduledAt)
    }
    return map
  }, [groups])

  // 최초 선택일: 오늘 일정이 있으면 오늘, 없으면 가장 가까운 일정이 있는 날짜, 없으면 오늘
  const initialDate = useMemo(() => {
    if (eventsByDate.has(todayKey)) return todayKey
    const allKeys = [...eventsByDate.keys()].sort()
    const upcoming = allKeys.find((k) => k >= todayKey)
    return upcoming ?? allKeys[0] ?? todayKey
  }, [eventsByDate, todayKey])

  const [selectedDate, setSelectedDate] = useState<string>(initialDate)
  const [viewYear, setViewYear] = useState<number>(() => {
    const [y] = (initialDate || todayKey).split('-').map(Number)
    return y
  })
  const [viewMonth, setViewMonth] = useState<number>(() => {
    const [, m] = (initialDate || todayKey).split('-').map(Number)
    return m
  })

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1)
      setViewMonth(12)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1)
      setViewMonth(1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  const handleGoToday = () => {
    setViewYear(todayYear)
    setViewMonth(todayMonth)
    setSelectedDate(todayKey)
  }

  // 달력 격자 계산
  const { prevTrailingDays, currentMonthDays } = useMemo(
    () => computeMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  )

  const selectedEvents = eventsByDate.get(selectedDate) ?? []

  return (
    <div className="flex flex-col px-5 pb-4 pt-1">
      <div className="grid grid-cols-[248px_minmax(0,1fr)] gap-4 items-stretch">
        {/* 좌측: 미니 캘린더 피커 */}
        <div className="flex flex-col p-3 rounded-[18px] bg-wash/[0.02] border border-edge/[0.08]">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[13.5px] font-bold text-ink-1 tabular-nums">
              {viewYear}년 {viewMonth}월
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="이전 달"
                className="w-6 h-6 rounded-[7px] border border-edge/[0.1] bg-wash/[0.03] text-ink-2 hover:text-ink-1 hover:bg-wash/[0.08] flex items-center justify-center text-[12px] transition-colors"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="다음 달"
                className="w-6 h-6 rounded-[7px] border border-edge/[0.1] bg-wash/[0.03] text-ink-2 hover:text-ink-1 hover:bg-wash/[0.08] flex items-center justify-center text-[12px] transition-colors"
              >
                ›
              </button>
              <button
                type="button"
                onClick={handleGoToday}
                className="px-2 h-6 rounded-[7px] border border-edge/[0.1] bg-wash/[0.03] text-ink-2 hover:text-ink-1 hover:bg-wash/[0.08] text-[11.5px] font-semibold transition-colors"
              >
                오늘
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center mb-0.5 text-[11px] font-semibold text-ink-3">
            {WEEKDAYS.map((w) => (
              <span key={w}>
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {prevTrailingDays.map((d) => (
              <div
                key={`prev-${d}`}
                className="h-7 flex items-center justify-center text-[12px] text-ink-4 opacity-40 select-none"
              >
                {d}
              </div>
            ))}

            {currentMonthDays.map((d) => {
              const dateKey = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const isToday = dateKey === todayKey
              const isSelected = dateKey === selectedDate
              const dayEvents = eventsByDate.get(dateKey) ?? []
              const hasEvents = dayEvents.length > 0
              const hasMine = dayEvents.some((e) => tags.has(e.ticker))

              return (
                <button
                  key={`cur-${d}`}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                  className={`relative h-7 flex flex-col items-center justify-center rounded-[9px] text-[12.5px] font-medium transition-all duration-150 ${
                    isSelected
                      ? 'glass gbtn-lapis font-bold shadow-sm'
                      : isToday
                      ? 'border border-lapis/50 text-ink-1 font-semibold hover:bg-wash/[0.06]'
                      : 'text-ink-2 hover:bg-wash/[0.05] hover:text-ink-1'
                  }`}
                  aria-label={`${dateKey} 일정 ${dayEvents.length}건`}
                >
                  <span className="tabular-nums">{d}</span>
                  {hasEvents && (
                    <div className="flex gap-0.5 absolute bottom-0.5">
                      <span
                        className={`w-1 h-1 rounded-full ${
                          isSelected ? 'bg-current opacity-90' : hasMine ? 'bg-gold' : 'bg-ink-3'
                        }`}
                      />
                      {dayEvents.length > 1 && (
                        <span
                          className={`w-1 h-1 rounded-full ${
                            isSelected ? 'bg-current opacity-60' : 'bg-ink-3'
                          }`}
                        />
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 우측: 선택 일자 어닝콜 카드 목록 */}
        <div className="relative min-h-0">
          <div className="absolute inset-0 flex flex-col">
          <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-edge/[0.06]">
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <h3 className="text-[14px] font-bold text-ink-1 whitespace-nowrap">
                {formatKstDateHeader(selectedDate)}
              </h3>
              {selectedDate === todayKey && (
                <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-lapis/15 text-lapis whitespace-nowrap">
                  오늘
                </span>
              )}
            </div>
            <span className="text-[12px] text-ink-3 tabular-nums whitespace-nowrap">
              {selectedEvents.length > 0 ? `${selectedEvents.length}건 예정` : '예정 없음'}
            </span>
          </div>

          {selectedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center text-ink-3 text-[13px]">
              <p>선택한 날짜에 예정된 실적 발표 콜이 없습니다.</p>
              <p className="text-[11.5px] text-ink-4 mt-1">달력에서 점이 표시된 날짜를 눌러 일정을 확인하세요.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pr-1">
              {selectedEvents.map((e) => {
                const tag = tags.get(e.ticker)
                return (
                  <li key={`${e.ticker}-${e.scheduledAt}`}>
                    <button
                      type="button"
                      onClick={() => onPick(e.ticker)}
                      className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-[12px] bg-wash/[0.03] border border-edge/[0.06] hover:bg-wash/[0.06] transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="shrink-0 text-[12px] font-semibold text-ink-2 tabular-nums">
                          {formatClock(e.scheduledAt)}
                        </span>
                        <div className="flex items-baseline gap-2 min-w-0 flex-1">
                          <span className="shrink-0 num text-[14.5px] font-bold text-ink-1">
                            {e.ticker}
                          </span>
                          <span className="text-[13px] text-ink-2 truncate min-w-0">
                            {e.name}
                          </span>
                          {tag && (
                            <span
                              className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold border ${
                                tag === '보유'
                                  ? 'text-ink-1 border-edge/25'
                                  : 'text-ink-3 border-edge/10'
                              }`}
                            >
                              {tag}
                            </span>
                          )}
                        </div>
                      </div>

                      <span className="shrink-0 text-[13px] text-ink-3 group-hover:text-ink-1 transition-colors" aria-hidden="true">
                        ›
                      </span>
                      <span className="sr-only">종목 브리핑 열기</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
