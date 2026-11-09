import { useMemo, useState } from 'react'
import type { TranscriptSegment } from '../../store/useTranscriptStore'
import type { TranscriptDiffItem } from '../../store/useTranscriptDiffStore'
import { formatCallClock, isProminentDiff, timelineMarks } from '../../lib/callScreen'
import { CHANGE_META, topicLabel } from './diffMeta'

interface CallTimelineProps {
  segments: readonly TranscriptSegment[]
  diffItems: readonly TranscriptDiffItem[]
  onFocusSequence: (sequence: number) => void
  className?: string
}

/**
 * 콜 가로 시간축 (W11, incident-timeline).
 *
 * 콜 처음부터 지금까지를 한 줄에 펴고, 직전 콜과 달라진 대목을 점으로 찍는다. 점에 올리면 무엇이
 * 달라졌는지 보이고, 누르면 그 발언으로 자막을 옮긴다. 진행 중인 콜은 끝을 모르므로 오른쪽 끝이 지금이다.
 */
export default function CallTimeline({ segments, diffItems, onFocusSequence, className = '' }: CallTimelineProps) {
  // 점은 발언 번호로 기억한다. 진행 중에 앞쪽 대조가 끼어들어도 보던 점의 설명이 바뀌지 않는다.
  const [hover, setHover] = useState<number | null>(null)

  const { totalMs, marks } = useMemo(() => timelineMarks(segments, diffItems), [segments, diffItems])

  const active = hover != null ? marks.find((m) => m.sequence === hover) ?? null : null

  return (
    <div className={`flex items-center gap-3 ${className}`} role="group" aria-label="콜 시간축 · 직전 콜과 달라진 대목">
      <span className="num text-[11px] text-ink-3 shrink-0">00:00</span>
      <div className="relative flex-1 h-6">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full dent" aria-hidden="true" />
        {marks.map((m) => {
          const meta = CHANGE_META[m.lead.changeType]
          const big = isProminentDiff(m.lead)
          const label = m.items
            .map((it) => `${CHANGE_META[it.changeType].label} · ${topicLabel(it.topic)}: ${it.summaryKo}`)
            .join(' / ')
          return (
            <button
              key={m.sequence}
              type="button"
              onClick={() => onFocusSequence(m.sequence)}
              onPointerEnter={() => setHover(m.sequence)}
              onPointerLeave={() => setHover((h) => (h === m.sequence ? null : h))}
              onFocus={() => setHover(m.sequence)}
              onBlur={() => setHover((h) => (h === m.sequence ? null : h))}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full
                         transition-transform duration-200 hover:scale-125 focus-visible:scale-125"
              style={{ left: `${m.ratio * 100}%` }}
              aria-label={`${formatCallClock(m.startMs)} ${label}`}
            >
              <span
                className="block rounded-full"
                style={{
                  width: big ? 11 : 8,
                  height: big ? 11 : 8,
                  background: meta.color,
                  boxShadow: big ? `0 0 0 3px color-mix(in srgb, ${meta.color} 22%, transparent)` : undefined,
                }}
              />
            </button>
          )
        })}
        {active && (
          <div
            className="read absolute top-full mt-2 z-10 w-[280px] rounded-[14px] px-3.5 py-2.5 pointer-events-none flex flex-col gap-2"
            style={{
              left: `clamp(0px, calc(${active.ratio * 100}% - 140px), calc(100% - 280px))`,
            }}
            aria-hidden="true"
          >
            {active.items.map((it, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 text-[11.5px]">
                  {i === 0 && <span className="num text-ink-3">{formatCallClock(active.startMs)}</span>}
                  <span className="font-semibold" style={{ color: CHANGE_META[it.changeType].color }}>
                    {CHANGE_META[it.changeType].symbol} {CHANGE_META[it.changeType].label}
                  </span>
                  <span className="text-ink-2">{topicLabel(it.topic)}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-1">{it.summaryKo}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="num text-[11px] text-ink-3 shrink-0">{formatCallClock(totalMs)}</span>
    </div>
  )
}
