import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TranscriptSegment } from '../../store/useTranscriptStore'
import type { HighlightedTranslation } from '../../hooks/useTranscriptTranslation'
import type { GlossaryStatus } from '../../store/useGlossaryStore'
import type { TranscriptDiffItem } from '../../store/useTranscriptDiffStore'
import { computeViewportIndicator, formatCallClock, isProminentDiff, type ViewportIndicator } from '../../lib/callScreen'
import { CHANGE_META, topicLabel } from './diffMeta'
import TranslationBlock from './TranslationBlock'
import ScrollEdge from './ScrollEdge'
import CallTimeline from './CallTimeline'

interface TranscriptStreamProps {
  segments: readonly TranscriptSegment[]
  /** 발언 번호 → 그 발언에 붙는 직전 콜 대조. */
  diffsBySequence: ReadonlyMap<number, readonly TranscriptDiffItem[]>
  isLive: boolean
  /** 종료 후의 좁은 다시 보기. 대조는 칩만 보이고 글자가 작아진다. */
  compact?: boolean
  /** 위쪽에 떠 있는 콜 바 아래로 자막이 지나가도록 비워 두는 높이(px). */
  topInset: number
  onSpeakerClick?: (speaker: string) => void
  /** 이 발언으로 스크롤한다 (옆 탭의 대조 목록에서 누를 때). 같은 값으로 다시 누르면 nonce 로 구분한다. */
  focus?: { sequence: number; nonce: number } | null
  /** 번역 문단 — 묶음의 마지막 발언 번호 → 문단. */
  translations: ReadonlyMap<number, HighlightedTranslation>
  showTranslation: boolean
  onShowTranslationChange: (show: boolean) => void
  glossaryStatus: GlossaryStatus
  /** 이 발언을 범위로 질의응답을 연다. 없으면 버튼을 두지 않는다. */
  onAskAbout?: (sequence: number) => void
  /** 직전 콜 대조 항목 전체 (세로 시간축 레일용). */
  diffItems?: readonly TranscriptDiffItem[]
  onFocusSequence?: (sequence: number) => void
  /** 하위 호환용 */
  timeline?: ReactNode
}

/**
 * 자막 — 콜 진행 중의 주인공 (docs/design/ux.md 콜 시청).
 *
 *  - 길게 읽는 면이라 서리 유리 위에 둔다.
 *  - 직전 콜 대조는 해당 발언 바로 아래에 붙는다. `후퇴` · 고위험만 카드로 펼치고 나머지는 칩이다.
 *  - 대조가 있을 때 좌측에 세로 시간축 레일이 판 높이에 고정되어 콜 전체 개요(미니맵)를 제공한다.
 *  - 맨 아래를 보고 있을 때만 따라 내려간다. 위로 올려 읽는 중에는 멈추고 "새 발언 N개" 로 알린다.
 *  - text 는 외부 데이터라 innerHTML 을 쓰지 않는다.
 */
export default function TranscriptStream({
  segments,
  diffsBySequence,
  isLive,
  compact = false,
  topInset,
  onSpeakerClick,
  focus,
  translations,
  showTranslation,
  onShowTranslationChange,
  glossaryStatus,
  onAskAbout,
  diffItems,
  onFocusSequence,
}: TranscriptStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafIdRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState<ViewportIndicator>({ topPercent: 0, heightPercent: 100 })
  const [stuck, setStuck] = useState(true)
  // 따라 내려가기를 멈춘 순간의 발언 수. 그 뒤로 온 만큼이 "새 발언" 이다.
  const [seenCount, setSeenCount] = useState(segments.length)
  const [flash, setFlash] = useState<number | null>(null)

  const showTimeline = !compact && !!diffItems && diffItems.length > 0 && segments.length > 0 && !!onFocusSequence

  const updateViewport = () => {
    const el = scrollRef.current
    if (!el) return
    const next = computeViewportIndicator(el.scrollTop, el.clientHeight, el.scrollHeight)
    setViewport((prev) => {
      if (Math.abs(prev.topPercent - next.topPercent) < 0.2 && Math.abs(prev.heightPercent - next.heightPercent) < 0.2) {
        return prev
      }
      return next
    })
  }

  // 대조 카드와 번역은 발언보다 늦게 붙어 높이를 늘린다. 맨 아래를 보고 있었다면 그때도 따라 내려간다.
  useLayoutEffect(() => {
    if (!stuck) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setSeenCount(segments.length)
  }, [segments.length, diffsBySequence, translations, showTranslation, stuck])

  useEffect(() => {
    updateViewport()
  }, [segments.length, diffsBySequence])

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!focus) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-seq="${focus.sequence}"]`)
    if (!el) return
    setStuck(false)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(focus.sequence)
    const t = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(t)
  }, [focus])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== stuck) setStuck(atBottom)

    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        updateViewport()
      })
    }
  }

  function jumpToLatest() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setStuck(true)
  }

  const newCount = stuck ? 0 : Math.max(0, segments.length - seenCount)
  const latestSeq = segments.length > 0 ? segments[segments.length - 1].sequence : null

  return (
    <section className="cloud relative h-full rounded-[28px] overflow-hidden" aria-label="자막" data-tour="transcript">
      <ScrollEdge height={topInset + 12} />

      {/* 좌측 세로 레일 시간축 — 스크롤에 관계없이 판 높이에 고정 */}
      {showTimeline && (
        <CallTimeline
          segments={segments}
          diffItems={diffItems!}
          onFocusSequence={onFocusSequence!}
          viewport={viewport}
          className="absolute z-[3]"
          style={{
            top: topInset + 48,
            bottom: 24,
            left: 12,
            width: 24,
          }}
        />
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto"
        style={{ paddingTop: topInset }}
      >
        <div
          className={`flex items-center justify-between gap-3 ${
            compact ? 'px-5 pt-3 pb-2' : showTimeline ? 'pl-12 pr-7 pt-4 pb-3' : 'px-7 pt-4 pb-3'
          }`}
        >
          <span className="text-[13px] font-semibold text-ink-2">
            {compact ? '자막 다시 보기' : '자막'}
            <span className="tabular-nums text-ink-3 font-normal ml-2">{segments.length}문장</span>
          </span>
          {!compact && <TranslationToggle show={showTranslation} onChange={onShowTranslationChange} />}
        </div>
        {showTranslation && glossaryStatus === 'failed' && translations.size > 0 && !compact && (
          <p className={`${showTimeline ? 'pl-12 pr-7' : 'px-7'} -mt-1 pb-2 text-[12px] text-ink-3`}>
            용어 설명을 불러오지 못해 번역만 보여 줍니다.
          </p>
        )}

        {segments.length === 0 ? (
          <p className={`${showTimeline ? 'pl-12 pr-7' : 'px-7'} py-10 text-center text-[13px] text-ink-3`}>
            {isLive ? '첫 발언을 기다리고 있습니다.' : '받은 자막이 없습니다.'}
          </p>
        ) : (
          <ol
            role="log"
            aria-label="자막"
            className={`flex flex-col ${
              compact ? 'gap-3 px-5 pb-6' : showTimeline ? 'gap-5 pl-12 pr-7 pb-10' : 'gap-5 px-7 pb-10'
            }`}
          >
            {segments.map((seg, i) => {
              // 같은 사람이 이어 말하면 이름을 다시 쓰지 않고 앞 발언에 붙여 한 덩어리로 읽힌다.
              // 앞 발언 밑에 대조 · 번역이 붙어 있으면 그 아래로 당기지 않는다(카드에 딸린 글처럼 보인다).
              const prev = segments[i - 1]
              const continued = !!seg.speaker && seg.speaker === prev?.speaker
              const prevHasExtra =
                prev != null &&
                ((diffsBySequence.get(prev.sequence)?.length ?? 0) > 0 || (showTranslation && translations.has(prev.sequence)))
              const pullUp = continued && !prevHasExtra
              const diffs = diffsBySequence.get(seg.sequence)
              const translation = showTranslation ? translations.get(seg.sequence) : undefined
              const isLatest = isLive && seg.sequence === latestSeq
              return (
                <li
                  key={`${seg.callId}-${seg.sequence}`}
                  data-seq={seg.sequence}
                  className={`group flex flex-col gap-1.5 rounded-[14px] transition-colors duration-500 ${
                    pullUp ? (compact ? '-mt-1.5' : '-mt-2.5') : ''
                  } ${flash === seg.sequence ? 'bg-wash/[0.06]' : ''}`}
                >
                  <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                    <span className="num">{formatCallClock(seg.startMs)}</span>
                    {seg.speaker &&
                      (continued ? (
                        <span className="sr-only">{seg.speaker}</span>
                      ) : onSpeakerClick ? (
                        <button
                          type="button"
                          onClick={() => onSpeakerClick(seg.speaker as string)}
                          className="text-[12.5px] font-semibold text-ink-1 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                          aria-label={`${seg.speaker} 발화자 프로필 열기`}
                        >
                          {seg.speaker}
                        </button>
                      ) : (
                        <span className="text-[12.5px] font-semibold text-ink-1">{seg.speaker}</span>
                      ))}
                    {onAskAbout && (
                      <button
                        type="button"
                        onClick={() => onAskAbout(seg.sequence)}
                        className="ml-auto rounded-full px-2 py-0.5 text-ink-3 hover:text-ink-1 hover:bg-wash/[0.06]
                                   opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      >
                        이 대목 질문
                      </button>
                    )}
                  </div>
                  <p
                    className={`select-text leading-[1.6] ${
                      compact ? 'text-[13px]' : 'text-[14.5px]'
                    } ${isLatest ? 'text-ink-1' : compact ? 'text-ink-2' : 'text-ink-1/90'}`}
                  >
                    {seg.text}
                  </p>
                  {translation && <TranslationBlock item={translation} compact={compact} />}
                  {diffs && diffs.length > 0 && (
                    <div className="flex flex-col gap-2 pt-1">
                      {diffs.map((d, i) =>
                        !compact && isProminentDiff(d) ? (
                          <DiffCard key={`${d.topic}-${i}`} item={d} />
                        ) : (
                          <DiffChip key={`${d.topic}-${i}`} item={d} expandable={!compact} />
                        ),
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {newCount > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="gbtn gbtn-sm absolute left-1/2 -translate-x-1/2 bottom-4 z-10"
        >
          새 발언 <span className="tabular-nums">{newCount}</span>개 ↓
        </button>
      )}
    </section>
  )
}

/** 펼친 대조 카드 — `후퇴` 또는 위험 점수가 높은 항목. 직전 발언과 이번 발언 원문을 나란히 둔다. */
function DiffCard({ item }: { item: TranscriptDiffItem }) {
  const meta = CHANGE_META[item.changeType]
  return (
    <div className="cloud-s rounded-[18px] px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold" style={{ color: meta.color }}>
          {meta.symbol} {meta.label} · {topicLabel(item.topic)}
        </span>
        <span className="text-[11px] text-ink-3">신뢰 <span className="tabular-nums">{Math.round(item.confidence * 100)}%</span></span>
      </div>
      <p className="text-[13.5px] text-ink-1 leading-snug">{item.summaryKo}</p>
      {/*
        직전 발언은 원문 그대로 보여 준다. 요약만 띄우면 근거를 확인할 수 없고,
        판단이 맞는지 발표 자리에서 검증할 방법이 없어진다.
      */}
      <div className="grid grid-cols-2 gap-3">
        <Quote label="직전 콜" text={item.priorClaim} />
        <Quote label="이번 콜" text={item.currentClaim} />
      </div>
    </div>
  )
}

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-ink-3">{label}</span>
      <p className="text-[12px] text-ink-2 leading-snug select-text">{text || '—'}</p>
    </div>
  )
}

/** 낮은 강도의 대조 표시. 누르면 요약 · 직전 발언 · 신뢰도가 펼쳐진다. */
function DiffChip({ item, expandable }: { item: TranscriptDiffItem; expandable: boolean }) {
  const [open, setOpen] = useState(false)
  const meta = CHANGE_META[item.changeType]
  if (!expandable) {
    // 종료 후 좁은 보기에서는 펼치지 않는다. 누를 수 없는 것을 버튼으로 그리지 않는다.
    return (
      <span className="cloud-s rim self-start inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold" title={item.summaryKo}>
        <span className="whitespace-nowrap" style={{ color: meta.color }}>
          {meta.symbol} {meta.label}
        </span>
        <span className="whitespace-nowrap text-ink-3 font-medium">{topicLabel(item.topic)}</span>
      </span>
    )
  }
  if (open) {
    return (
      <div className="flex flex-col gap-1.5">
        <DiffCard item={item} />
        <button type="button" onClick={() => setOpen(false)} className="self-start text-[11px] text-ink-3 hover:text-ink-1">
          접기
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="cloud-s rim self-start inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold max-w-full"
      aria-label={`${meta.label} · ${topicLabel(item.topic)} — 펼쳐 보기`}
      title={item.summaryKo}
    >
      {/* 좁을 때 줄어드는 것은 요약뿐이다. 유형과 주제는 한 줄로 둔다 */}
      <span className="shrink-0 whitespace-nowrap" style={{ color: meta.color }}>
        {meta.symbol} {meta.label}
      </span>
      <span className="shrink-0 whitespace-nowrap text-ink-3 font-medium">{topicLabel(item.topic)}</span>
      <span className="min-w-0 text-ink-2 font-normal truncate">{item.summaryKo}</span>
    </button>
  )
}

/** 번역 보기 전환. 번역은 원문 몇 문장 묶음마다 몇 초 늦게 붙는다. */
function TranslationToggle({ show, onChange }: { show: boolean; onChange: (show: boolean) => void }) {
  const options = [
    { value: false, label: '원문' },
    { value: true, label: '원문 + 번역' },
  ]
  return (
    <div className="dent inline-flex p-1 rounded-full text-[12px]" role="group" aria-label="자막 보기">
      {options.map((o) => {
        const active = o.value === show
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3 py-1 ${
              active ? 'cloud-s rim font-semibold text-ink-1' : 'text-ink-3 hover:text-ink-1'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
