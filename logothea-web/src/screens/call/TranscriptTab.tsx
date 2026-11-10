import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import type { TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'
import type { HighlightedTranslation } from '@terminal/renderer/hooks/useTranscriptTranslation'
import type { TranscriptDiffItem } from '@terminal/renderer/store/useTranscriptDiffStore'
import { formatCallClock, isProminentDiff } from '@terminal/renderer/lib/callScreen'
import { CHANGE_META, topicLabel } from '@terminal/renderer/components/call/diffMeta'
import { usePrefs } from '../../app/prefs'
import { useCallUi } from '../../app/callUi'
import type { CallData } from './useCallData'
import { DiffDetail, openDiffSheet, openSpeakerSheet, openTermSheet } from './sheets'

/** 맨 아래로 보는 중이라고 볼 여백(px). */
const BOTTOM_SLACK = 32
const FLASH_MS = 1600
const NO_DIFFS: readonly TranscriptDiffItem[] = []

function atBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - BOTTOM_SLACK
}

/**
 * 이어 말하기 표기(데스크톱 TranscriptStream 과 같은 규칙).
 * 같은 사람이 이어 말하면 이름을 다시 쓰지 않는다. 앞 발언에 번역 · 대조가 붙어 있지 않을 때만 간격을 좁혀 한 덩어리로 읽히게 한다.
 */
export function speakerLayout(prev: TranscriptSegment | undefined, seg: TranscriptSegment, prevHasExtra: boolean): { showName: boolean; pullUp: boolean } {
  const continued = !!seg.speaker && seg.speaker === prev?.speaker
  return { showName: !!seg.speaker && !continued, pullUp: continued && !prevHasExtra }
}

/**
 * 자막. 데스크톱 TranscriptStream(components/call/TranscriptStream.tsx)을 모바일로 다시 만들었다.
 * - 번역은 묶음의 마지막 발언 아래 왼쪽 선 문단. 용어 밑줄을 누르면 용어 시트.
 * - 대조: 후퇴 · 위험 0.7 이상은 카드로 펼쳐 두고, 나머지 칩은 누르면 대조 상세 시트.
 * - 발언을 누르면 옅게 밝아지고 아래에 `이 대목 질문`. 다른 곳을 누르면 사라진다. 키보드 · 화면 낭독기는 시각 버튼으로 고른다.
 * - 맨 아래를 보고 있을 때만 따라 내려가고, 위로 올려 읽는 중에는 `새 발언 N개 ↓` 알약.
 */
export default function TranscriptTab({ data }: { data: CallData }) {
  const { segments, diffsBySequence, translations, glossaryStatus, phase, callId } = data
  const showTranslation = usePrefs((s) => s.showTranslation)
  const underline = usePrefs((s) => s.glossaryUnderline)
  const setPref = usePrefs((s) => s.set)
  const focus = useCallUi((s) => s.focus)

  const [stuck, setStuck] = useState(true)
  const [seenCount, setSeenCount] = useState(segments.length)
  const [flash, setFlash] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // 처음 열면 맨 아래(최신)에서 시작한다. 다른 곳에서 고른 발언이 있으면 아래 효과가 그리로 옮긴다
  useLayoutEffect(() => {
    if (!useCallUi.getState().focus) window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [])

  useEffect(() => {
    const onScroll = () => setStuck(atBottom())
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 맨 아래를 보고 있으면 새 발언 · 늦게 붙은 번역 · 대조를 따라 내려간다
  useLayoutEffect(() => {
    if (!stuck) return
    window.scrollTo({ top: document.documentElement.scrollHeight })
    setSeenCount(segments.length)
  }, [segments.length, diffsBySequence, translations, showTranslation, stuck])

  // 시간축 · 대조 · 질문에서 고른 발언으로 옮겨 밝힌다. 한 번 옮기면 지운다 — 남겨 두면 자막 탭에 돌아올 때마다 다시 옮긴다
  useEffect(() => {
    if (!focus) return
    useCallUi.setState({ focus: null })
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seq="${focus.sequence}"]`)
    if (!el) return
    setStuck(false)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(focus.sequence)
  }, [focus])
  useEffect(() => {
    if (flash == null) return
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])

  // 새 회차면 지난 회차에서 고른 발언을 버린다(같은 번호의 다른 문장이 밝아지지 않게)
  useEffect(() => setSelected(null), [callId])

  // 고른 발언 밖을 누르면 `이 대목 질문` 을 거둔다
  useEffect(() => {
    if (selected == null) return
    const onDown = (e: PointerEvent) => {
      const li = listRef.current?.querySelector(`[data-seq="${selected}"]`)
      if (!li || !li.contains(e.target as Node)) setSelected(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [selected])

  const toggle = useCallback((sequence: number) => setSelected((cur) => (cur === sequence ? null : sequence)), [])

  const newCount = stuck ? 0 : Math.max(0, segments.length - seenCount)
  const latestSeq = phase === 'LIVE' && segments.length > 0 ? segments[segments.length - 1].sequence : null

  return (
    <>
      <section className="feed cloud" aria-label="자막">
        <div className="feed-h">
          <span>
            자막 <span className="tnum">{segments.length}</span>문장
          </span>
          <span className="seg dent seg-sm" role="group" aria-label="자막 보기">
            {[
              { value: false, label: '원문' },
              { value: true, label: '원문 + 번역' },
            ].map((o) => (
              <button key={o.label} type="button" aria-pressed={showTranslation === o.value} onClick={() => setPref('showTranslation', o.value)}>
                {o.label}
              </button>
            ))}
          </span>
        </div>
        {showTranslation && underline && glossaryStatus === 'failed' && translations.size > 0 && (
          <p className="fine">용어 설명을 불러오지 못해 번역만 보여 줍니다.</p>
        )}
        {segments.length === 0 ? (
          <p className="state">{phase === 'LIVE' ? '첫 발언을 기다리고 있습니다.' : '방송을 기다리고 있습니다. 콜이 시작되면 자막이 여기에 쌓입니다.'}</p>
        ) : (
          <ol ref={listRef} aria-label="자막" className="utts">
            {segments.map((seg, i) => {
              const prev = segments[i - 1]
              const prevHasExtra =
                prev != null && ((diffsBySequence.get(prev.sequence)?.length ?? 0) > 0 || (showTranslation && translations.has(prev.sequence)))
              const { showName, pullUp } = speakerLayout(prev, seg, prevHasExtra)
              return (
                <Utterance
                  key={`${seg.callId}-${seg.sequence}`}
                  seg={seg}
                  showName={showName}
                  pullUp={pullUp}
                  translation={showTranslation ? translations.get(seg.sequence) : undefined}
                  underline={underline}
                  diffs={diffsBySequence.get(seg.sequence) ?? NO_DIFFS}
                  selected={selected === seg.sequence}
                  flash={flash === seg.sequence}
                  latest={latestSeq === seg.sequence}
                  onToggle={toggle}
                />
              )
            })}
          </ol>
        )}
      </section>
      {newCount > 0 && (
        <button
          type="button"
          className="newpill glass"
          onClick={() => {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
            setStuck(true)
          }}
        >
          새 발언 <span className="tnum">{newCount}</span>개 ↓
        </button>
      )}
    </>
  )
}

/** 발언 한 줄. 새 발언이 와도 바뀌지 않은 줄은 다시 그리지 않는다. */
const Utterance = memo(function Utterance({
  seg,
  showName,
  pullUp,
  translation,
  underline,
  diffs,
  selected,
  flash,
  latest,
  onToggle,
}: {
  seg: TranscriptSegment
  showName: boolean
  pullUp: boolean
  translation: HighlightedTranslation | undefined
  underline: boolean
  diffs: readonly TranscriptDiffItem[]
  selected: boolean
  flash: boolean
  latest: boolean
  onToggle: (sequence: number) => void
}) {
  const askAbout = useCallUi((s) => s.askAbout)
  const clock = formatCallClock(seg.startMs)
  const select = (e: MouseEvent) => {
    // 안의 버튼(화자 · 용어 · 대조)이나 글자 고르기는 발언 고르기가 아니다
    if ((e.target as HTMLElement).closest('button')) return
    if (window.getSelection()?.toString()) return
    onToggle(seg.sequence)
  }
  return (
    <li data-seq={seg.sequence} className={`utt ${pullUp ? 'pull' : ''} ${selected || flash ? 'focus' : ''} ${latest ? 'latest' : ''}`} onClick={select}>
      <div className="who">
        {/* 키보드 · 화면 낭독기로 발언을 고르는 자리. 누르는 것과 같다 */}
        <button
          type="button"
          className="num tm tm-btn"
          aria-expanded={selected}
          aria-label={`${clock}${seg.speaker ? ` ${seg.speaker}` : ''} 발언 고르기`}
          onClick={() => onToggle(seg.sequence)}
        >
          {clock}
        </button>
        {seg.speaker &&
          (showName ? (
            <button type="button" className="who-name" onClick={() => openSpeakerSheet(seg.speaker as string)}>
              {seg.speaker}
            </button>
          ) : (
            <span className="sr-only">{seg.speaker}</span>
          ))}
      </div>
      <p className="utt-text">{seg.text}</p>
      {translation && <Translation item={translation} underline={underline} />}
      {diffs.length > 0 && (
        <div className="diffs">
          {diffs.map((d, k) => (isProminentDiff(d) ? <DiffCard key={`${d.topic}-${k}`} item={d} /> : <DiffChip key={`${d.topic}-${k}`} item={d} />))}
        </div>
      )}
      {selected && (
        <div className="actrow">
          <button type="button" className="gb pill-sm" onClick={() => askAbout(seg.sequence)}>
            이 대목 질문
          </button>
        </div>
      )}
    </li>
  )
})

/** 번역 문단. 용어 밑줄을 끄면 밑줄 없이 번역만 둔다(내 정보 > 용어 밑줄). */
const Translation = memo(function Translation({ item, underline }: { item: HighlightedTranslation; underline: boolean }) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  if (underline) {
    item.spans.forEach((span, i) => {
      if (span.start < cursor || span.end > item.textKo.length || span.end <= span.start) return
      if (span.start > cursor) parts.push(item.textKo.slice(cursor, span.start))
      const text = item.textKo.slice(span.start, span.end)
      parts.push(
        <button key={`${span.start}-${i}`} type="button" className="term" aria-haspopup="dialog" onClick={() => openTermSheet(span.term)} aria-label={`${text} — 용어 설명 보기`}>
          {text}
        </button>,
      )
      cursor = span.end
    })
  }
  if (cursor < item.textKo.length) parts.push(item.textKo.slice(cursor))
  return (
    <div className="tr">
      <span className="lab">번역</span>
      <p>{parts}</p>
    </div>
  )
})

function DiffCard({ item }: { item: TranscriptDiffItem }) {
  const meta = CHANGE_META[item.changeType]
  return (
    <div className="dcard cloud-s">
      <div className="dcard-h">
        <b style={{ color: meta.color }}>
          {meta.symbol} {meta.label}
        </b>
        <span>{topicLabel(item.topic)}</span>
      </div>
      <DiffDetail item={item} />
    </div>
  )
}

function DiffChip({ item }: { item: TranscriptDiffItem }) {
  const meta = CHANGE_META[item.changeType]
  return (
    <button type="button" className="chip cloud-s" onClick={() => openDiffSheet(item)} aria-label={`${meta.label} · ${topicLabel(item.topic)} — 대조 자세히 보기`}>
      <span style={{ color: meta.color }}>
        {meta.symbol} {meta.label}
      </span>
      <span className="chip-topic">{topicLabel(item.topic)}</span>
    </button>
  )
}
