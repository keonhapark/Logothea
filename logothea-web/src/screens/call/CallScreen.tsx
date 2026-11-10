import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { formatCallClock, timelineMarks, isProminentDiff } from '@terminal/renderer/lib/callScreen'
import { CHANGE_META, topicLabel } from '@terminal/renderer/components/call/diffMeta'
import { useCallUi, type CallTab } from '../../app/callUi'
import { useCallData, type CallData } from './useCallData'
import { openSpeakerSheet } from './sheets'
import TranscriptTab from './TranscriptTab'
import DiffTab from './DiffTab'
import AskTab from './AskTab'
import VerdictTab from './VerdictTab'

/** 시간축 띠가 차지하는 높이(띠 30px + 간격 6px). mobile.css 의 .call.with-timeline 과 같다. */
const TIMELINE_SPACE = 36

const TABS: { id: CallTab; label: string }[] = [
  { id: 'transcript', label: '자막' },
  { id: 'diff', label: '대조' },
  { id: 'ask', label: '질문' },
  { id: 'verdict', label: '판단' },
]

/**
 * 콜 화면. 위에 떠 있는 콜 캡슐과 그 아래 `자막 · 대조 · 질문 · 판단` 전환(탭 바를 두 겹으로 쌓지 않으려고),
 * 자막 탭에서는 그 아래 시간축 띠. 내용은 페이지 스크롤이다.
 * 데스크톱 TradingRoomPage · CallBar · CallSideTabs 를 모바일 한 열로 다시 만들었다.
 */
export default function CallScreen() {
  const data = useCallData()
  const tab = useCallUi((s) => s.tab)
  const { marks, totalMs } = useMemo(() => timelineMarks(data.segments, data.diffItems), [data.segments, data.diffItems])
  const showTimeline = tab === 'transcript' && marks.length > 0

  // 시간축 띠가 나타나거나 사라지면 내용 위 여백이 바뀐다. 위로 올려 읽는 중이면 읽던 글이 밀리지 않게 그만큼 스크롤을 옮긴다
  // (iOS Safari 는 스크롤 앵커링이 없다). 맨 아래를 보는 중이면 자막 탭이 따라 내려가므로 두지 않는다.
  const prevTimeline = useRef(showTimeline)
  useLayoutEffect(() => {
    if (prevTimeline.current === showTimeline) return
    prevTimeline.current = showTimeline
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48
    if (!atBottom && window.scrollY > 0) window.scrollBy(0, showTimeline ? TIMELINE_SPACE : -TIMELINE_SPACE)
  }, [showTimeline])

  return (
    <main className={`call ${showTimeline ? 'with-timeline' : ''}`}>
      <h1 className="sr-only" tabIndex={-1}>
        콜 · {data.ticker}
      </h1>
      <CallCapsule data={data} />
      <CallTabs data={data} />
      {showTimeline && <Timeline marks={marks} totalMs={totalMs} />}
      <div id={`call-panel-${tab}`} role="tabpanel" aria-labelledby={`call-tab-${tab}`} className="call-body">
        {tab === 'transcript' && <TranscriptTab data={data} />}
        {tab === 'diff' && <DiffTab data={data} />}
        {tab === 'ask' && <AskTab data={data} />}
        {tab === 'verdict' && <VerdictTab data={data} />}
      </div>
    </main>
  )
}

function initials(name: string): string {
  const parts = name.replace(/^[^·]+·\s*/, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function CallCapsule({ data }: { data: CallData }) {
  const last = data.segments[data.segments.length - 1]
  // 지금 말하는 사람: 마지막 발언의 화자
  const speaker = [...data.segments].reverse().find((s) => s.speaker)?.speaker ?? null
  return (
    <div className="call-capsule glass">
      <span className="call-tk">{data.ticker}</span>
      {data.phase === 'LIVE' ? (
        <span className="live">
          <i aria-hidden="true" />
          LIVE
        </span>
      ) : data.phase === 'ENDED' ? (
        <span className="live" style={{ color: 'var(--ink-3)' }}>
          종료
        </span>
      ) : (
        <span className="live" style={{ color: 'var(--ink-3)' }}>
          대기
        </span>
      )}
      <span className="call-clock num" aria-label={`경과 ${formatCallClock(last?.endMs ?? 0)}`}>
        {formatCallClock(last?.endMs ?? 0)}
      </span>
      {speaker && (
        <button type="button" className="call-face cloud-s" onClick={() => openSpeakerSheet(speaker)} aria-label={`${speaker} 화자 정보`}>
          {initials(speaker)}
        </button>
      )}
    </div>
  )
}

function CallTabs({ data }: { data: CallData }) {
  const tab = useCallUi((s) => s.tab)
  const setTab = useCallUi((s) => s.setTab)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const weakened = data.diffItems.filter((d) => d.changeType === 'weakened').length

  const go = (id: CallTab) => {
    setTab(id)
    window.scrollTo({ top: 0 })
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1
    if (next < 0) return
    e.preventDefault()
    go(TABS[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="call-tabs glass" role="tablist" aria-label="콜 보기">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          id={`call-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={`call-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => go(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.id === 'diff' && weakened > 0 && (
            <>
              <span className="call-tab-n" aria-hidden="true">
                {weakened}
              </span>
              <span className="sr-only">, 후퇴 {weakened}개</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * 시간축 띠. 점 규칙은 데스크톱 CallTimeline / timelineMarks 그대로이고, 미리 보기 말풍선 대신 누르면 바로 그 발언으로
 * 옮겨 1.6초 밝힌다. 점 누르는 자리는 44px.
 */
function Timeline({ marks, totalMs }: { marks: ReturnType<typeof timelineMarks>['marks']; totalMs: number }) {
  const focusSequence = useCallUi((s) => s.focusSequence)
  return (
    <div className="call-tl glass" role="group" aria-label="콜 시간축 · 직전 콜과 달라진 대목">
      <span className="num">00:00</span>
      <div className="call-track">
        <div className="call-rail dent" aria-hidden="true" />
        {marks.map((m) => {
          const meta = CHANGE_META[m.lead.changeType]
          const big = isProminentDiff(m.lead)
          const label = m.items.map((it) => `${CHANGE_META[it.changeType].label} · ${topicLabel(it.topic)}: ${it.summaryKo}`).join(' / ')
          return (
            <button
              key={m.sequence}
              type="button"
              className="call-dot"
              style={{ left: `${m.ratio * 100}%` }}
              onClick={() => focusSequence(m.sequence)}
              aria-label={`${formatCallClock(m.startMs)} ${label}. 그 발언으로 가기`}
            >
              <span
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
      </div>
      <span className="num">{formatCallClock(totalMs)}</span>
    </div>
  )
}
