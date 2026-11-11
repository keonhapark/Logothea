import { useMemo, useState } from 'react'
import type { TranscriptSegment } from '../../store/useTranscriptStore'
import type { TranscriptDiffItem } from '../../store/useTranscriptDiffStore'
import { formatCallClock, isProminentDiff, timelineMarks, type ViewportIndicator } from '../../lib/callScreen'
import { CHANGE_META, topicLabel } from './diffMeta'

export interface CallTimelineProps {
  segments: readonly TranscriptSegment[]
  diffItems: readonly TranscriptDiffItem[]
  onFocusSequence: (sequence: number) => void
  viewport?: ViewportIndicator
  className?: string
  style?: React.CSSProperties
}

/**
 * 콜 세로 시간축 레일 (W11, incident-timeline 세로 레일).
 *
 * 콜 처음(위: 00:00)부터 지금까지(아래: 지금)를 세로로 펴고, 직전 콜과 달라진 대목을 점으로 찍는다.
 * 현재 보고 있는 구간(viewport)은 레일 축 위에 반투명 막대로 표시된다.
 * 점에 올리면 오른쪽에 무엇이 달라졌는지 팝오버로 보이고, 누르면 그 발언으로 자막을 옮긴다.
 * 맨 아래 '지금' 표시의 펄스는 prefers-reduced-motion 에서 멈춘다.
 */
export default function CallTimeline({
  segments,
  diffItems,
  onFocusSequence,
  viewport,
  className = '',
  style,
}: CallTimelineProps) {
  // 점은 발언 번호로 기억한다. 진행 중에 앞쪽 대조가 끼어들어도 보던 점의 설명이 바뀌지 않는다.
  const [hover, setHover] = useState<number | null>(null)

  const { totalMs, marks } = useMemo(() => timelineMarks(segments, diffItems), [segments, diffItems])

  const active = hover != null ? marks.find((m) => m.sequence === hover) ?? null : null

  return (
    <aside
      className={`relative flex flex-col items-center select-none ${className}`}
      style={style}
      role="group"
      aria-label="콜 시간축 · 직전 콜과 달라진 대목"
    >
      {/* 콜 시작 시각 */}
      <span className="num text-[10px] text-ink-3/70 tracking-tighter shrink-0 mb-1 select-none">
        00:00
      </span>

      {/* 세로 레일 트랙 영역 */}
      <div className="relative flex-1 w-full min-h-[140px] flex justify-center py-2">
        {/* 음각 세로 트랙 선 */}
        <div
          className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-[3px] rounded-full dent"
          aria-hidden="true"
        />

        {/* 지금 보는 구간 막대 (스크롤 뷰포트 인디케이터) */}
        {viewport && (
          <div
            className="absolute left-1/2 -translate-x-1/2 w-1.5 rounded-full bg-ink-2/25 border border-edge/30 transition-[top,height] duration-75 pointer-events-none"
            style={{
              top: `calc(8px + (100% - 16px) * ${viewport.topPercent / 100})`,
              height: `calc((100% - 16px) * ${viewport.heightPercent / 100})`,
            }}
            aria-hidden="true"
          />
        )}

        {/* 대조 점들 */}
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
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full
                         transition-transform duration-200 hover:scale-125 focus-visible:scale-125 z-10 outline-none"
              style={{ top: `calc(8px + (100% - 16px) * ${m.ratio})` }}
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

        {/* 맨 아래 '지금' 표시 — prefers-reduced-motion 에서 펄스 멈춤 */}
        <div
          className="absolute bottom-1 left-1/2 -translate-x-1/2 grid place-items-center pointer-events-none"
          title="지금"
          aria-hidden="true"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ink-3/60 motion-safe:animate-pulse" />
        </div>

        {/* 점에 올렸을 때 오른쪽에 뜨는 팝오버 (자막 판 오른쪽 끝을 넘지 않도록 제한) */}
        {active && (
          <div
            className="read absolute left-[calc(100%+8px)] z-20 w-[270px] rounded-[14px] px-3.5 py-2.5 pointer-events-none flex flex-col gap-2 shadow-lg"
            style={{
              top: `clamp(4px, calc(8px + (100% - 16px) * ${active.ratio} - 32px), calc(100% - 140px))`,
              maxWidth: 'clamp(200px, 320px, calc(100vw - 360px))',
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
                <p className="mt-1 text-[12.5px] leading-snug text-ink-1 break-words">{it.summaryKo}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 콜 경과 시각 */}
      <span className="num text-[10px] text-ink-3/70 tracking-tighter shrink-0 mt-1 select-none">
        {formatCallClock(totalMs)}
      </span>
    </aside>
  )
}
