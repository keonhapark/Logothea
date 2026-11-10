import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useAssistantStore,
  selectIsStreaming,
  selectRemainingQuestions,
  type AssistantCitation,
  type AssistantTurn,
} from '@terminal/renderer/store/useAssistantStore'
import {
  ASSISTANT_DISCLAIMER,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS_PER_CONVERSATION,
  MISSING_SOURCE_LABELS,
  SUGGESTED_QUESTIONS,
} from '@terminal/renderer/constants/assistant'
import type { SuggestedQuestionId } from '@terminal/lib/types/assistant'
import type { TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'
import { formatCallClock } from '@terminal/renderer/lib/callScreen'
import { citationKindLabel, numberCitations, splitAnswer } from '@terminal/renderer/lib/assistantAnswer'
import { useCallUi } from '../../app/callUi'
import type { CallData } from './useCallData'

/**
 * 질문. 데스크톱 AssistantPanel(components/call/AssistantPanel.tsx)을 모바일로 다시 만들었다. 대화 상태 · 요청은
 * 터미널 useAssistantStore 그대로다. 모바일에서 달라진 것:
 * - 범위 줄에 남은 질문 수를 함께 쓴다.
 * - 입력칸은 탭 바 위에 붙고, 키보드가 올라오면 visualViewport 기준으로 키보드 위에 붙는다.
 * - Enter 는 보내기, Shift+Enter 는 줄바꿈(데스크톱과 같음). 한글 조합 중 Enter 는 보내지 않는다.
 */
export default function AskTab({ data }: { data: CallData }) {
  const { ticker, callId, segments, phase } = data
  const anchorSequence = useCallUi((s) => s.anchorSequence)
  const clearAnchor = useCallUi((s) => s.clearAnchor)
  const focusSequence = useCallUi((s) => s.focusSequence)

  const conversation = useAssistantStore((s) => s.conversation)
  const open = useAssistantStore((s) => s.open)
  const ask = useAssistantStore((s) => s.ask)
  const cancel = useAssistantStore((s) => s.cancel)
  const reset = useAssistantStore((s) => s.reset)
  const streaming = useAssistantStore(selectIsStreaming)
  const remaining = useAssistantStore(selectRemainingQuestions)
  const lastError = useAssistantStore((s) => s.conversation?.turns.at(-1)?.error?.code ?? null)

  useEffect(() => {
    if (callId) open({ ticker, callId, anchorSequence })
  }, [open, ticker, callId, anchorSequence])

  const bySequence = useMemo(() => new Map(segments.map((s) => [s.sequence, s])), [segments])
  const anchor = anchorSequence != null ? bySequence.get(anchorSequence) ?? null : null
  const turns = conversation?.turns ?? []
  const lastTurn = turns[turns.length - 1]
  const isLive = phase === 'LIVE'

  // 답이 늘어나는 동안 맨 아래를 따라간다(위로 올려 읽는 중이면 두지 않는다)
  const stuck = useRef(true)
  useEffect(() => {
    const onScroll = () => {
      stuck.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    if (stuck.current) window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [turns.length, lastTurn?.text, lastTurn?.status, lastTurn?.citations.length])

  // 입력칸(과 키보드)이 덮는 높이만큼 아래를 비워 마지막 답이 가려지지 않게 한다
  const [composerSpace, setComposerSpace] = useState(160)

  if (!callId) {
    return <p className="cloud panel state">콜이 시작되면 콜 내용에 대해 물어볼 수 있습니다.</p>
  }

  const send = (question: string, suggestedQuestionId: SuggestedQuestionId | null = null) => {
    stuck.current = true
    void ask({ question, suggestedQuestionId })
  }

  return (
    <div className="ask" style={{ paddingBottom: composerSpace }}>
      <Scope anchor={anchor} anchorSequence={anchorSequence} remaining={remaining} onClearAnchor={clearAnchor} onFocusSequence={focusSequence} />
      {turns.length === 0 ? (
        <Suggested
          title={anchor ? '이 대목 말고 콜 전체에 대해 물어볼 수도 있습니다' : '이런 걸 물어볼 수 있습니다'}
          ids={SUGGESTED_QUESTIONS.map((q) => q.id)}
          disabled={streaming}
          onAsk={send}
        />
      ) : (
        turns.map((turn, i) => (
          <TurnView
            key={turn.id}
            turn={turn}
            isLast={i === turns.length - 1}
            isLive={isLive}
            bySequence={bySequence}
            canAsk={!streaming && remaining > 0}
            onAsk={send}
            onFocusSequence={focusSequence}
          />
        ))
      )}
      <p className="sr-only" aria-live="polite">
        {lastTurn ? STATUS_ANNOUNCE[lastTurn.status] : ''}
      </p>
      <Composer
        streaming={streaming}
        remaining={remaining}
        locked={lastError === 'daily_limit_exceeded'}
        callId={callId}
        onSend={(q) => send(q)}
        onCancel={() => void cancel()}
        onNewConversation={() => {
          reset()
          open({ ticker, callId, anchorSequence })
        }}
        onSpaceChange={setComposerSpace}
      />
    </div>
  )
}

function Scope({
  anchor,
  anchorSequence,
  remaining,
  onClearAnchor,
  onFocusSequence,
}: {
  anchor: TranscriptSegment | null
  anchorSequence: number | null
  remaining: number
  onClearAnchor: () => void
  onFocusSequence: (sequence: number) => void
}) {
  const left = (
    <span className="scope-left">
      남은 질문 <span className="tnum">{remaining}</span>
    </span>
  )
  if (anchorSequence == null) {
    return (
      <div className="scope cloud-s">
        <span>
          <span className="scope-k">범위</span> · 콜 전체
        </span>
        {left}
      </div>
    )
  }
  return (
    <div className="scope scope-anchor cloud-s">
      <div className="scope-row">
        <span>
          <span className="scope-k">범위</span> · 이 대목
        </span>
        <button type="button" className="link-btn" onClick={onClearAnchor}>
          콜 전체로
        </button>
      </div>
      {anchor ? (
        <button type="button" className="scope-quote" onClick={() => onFocusSequence(anchor.sequence)}>
          <span className="fine">
            <span className="num">{formatCallClock(anchor.startMs)}</span>
            {anchor.speaker && ` · ${anchor.speaker}`} · 자막에서 보기
          </span>
          <span className="scope-text">{anchor.text}</span>
        </button>
      ) : (
        <span className="fine">고른 발언을 자막에서 찾지 못했습니다.</span>
      )}
      {left}
    </div>
  )
}

function Suggested({
  title,
  ids,
  disabled,
  onAsk,
}: {
  title: string
  ids: readonly SuggestedQuestionId[]
  disabled: boolean
  onAsk: (question: string, id: SuggestedQuestionId) => void
}) {
  const items = SUGGESTED_QUESTIONS.filter((q) => ids.includes(q.id))
  if (items.length === 0) return null
  return (
    <div className="suggest">
      <span className="fine">{title}</span>
      <div className="suggest-list">
        {items.map((q) => (
          <button key={q.id} type="button" className="glass pill suggest-btn" disabled={disabled} onClick={() => onAsk(q.label, q.id)}>
            {q.label}
          </button>
        ))}
      </div>
      <span className="fine">추천 질문은 고른 대목과 관계없이 콜 전체를 보고 답합니다.</span>
    </div>
  )
}

function TurnView({
  turn,
  isLast,
  isLive,
  bySequence,
  canAsk,
  onAsk,
  onFocusSequence,
}: {
  turn: AssistantTurn
  isLast: boolean
  isLive: boolean
  bySequence: ReadonlyMap<number, TranscriptSegment>
  canAsk: boolean
  onAsk: (question: string, id?: SuggestedQuestionId | null) => void
  onFocusSequence: (sequence: number) => void
}) {
  const [flash, setFlash] = useState<{ marker: string; nonce: number } | null>(null)
  const numbers = useMemo(() => numberCitations(turn.text, turn.citations.map((c) => c.marker)), [turn.text, turn.citations])
  const byMarker = useMemo(() => new Map(turn.citations.map((c) => [c.marker, c])), [turn.citations])
  const citationsDone = turn.status !== 'pending' && turn.status !== 'streaming'
  const asOf = turn.meta ? bySequence.get(turn.meta.asOfSequence) : undefined

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(t)
  }, [flash])

  return (
    <article className="turn" aria-label={`질문: ${turn.question}`}>
      <p className="bub">{turn.question}</p>
      <div className="ans" aria-busy={turn.status === 'streaming' || turn.status === 'pending'}>
        {turn.status === 'pending' && <p className="fine">콜 내용에서 근거를 찾고 있습니다…</p>}
        {turn.text && (
          <p className="ans-text">
            {splitAnswer(visibleText(turn)).map((part, i) =>
              part.kind === 'text' ? (
                part.strong ? (
                  <strong key={i}>{part.text}</strong>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              ) : (
                <CiteChip
                  key={i}
                  number={numbers.get(part.marker)}
                  citation={byMarker.get(part.marker)}
                  citationsDone={citationsDone}
                  onClick={() => setFlash({ marker: part.marker, nonce: Date.now() })}
                />
              ),
            )}
            {turn.status === 'streaming' && <span className="caret" aria-hidden="true" />}
          </p>
        )}
        {turn.status === 'cancelled' && <p className="fine">질문을 취소했습니다.</p>}
        {turn.status === 'error' && turn.error && (
          <div className="ans-error">
            <p>
              {turn.error.message}
              {turn.error.code === 'daily_limit_exceeded' && turn.resetAt && ` ${formatResetAt(turn.resetAt)}부터 다시 질문할 수 있습니다.`}
            </p>
            {!NO_RETRY_CODES.has(turn.error.code) && isLast && (
              <button type="button" className="glass pill" disabled={!canAsk} onClick={() => onAsk(turn.question, turn.suggestedQuestionId)}>
                다시 질문
              </button>
            )}
          </div>
        )}
        {turn.status === 'refused' && isLast && (
          <Suggested title="대신 이런 질문은 답할 수 있습니다" ids={turn.suggestedQuestionIds} disabled={!canAsk} onAsk={onAsk} />
        )}
        {turn.meta && turn.meta.missingSources.length > 0 && (
          <p className="fine">{turn.meta.missingSources.map((s) => MISSING_SOURCE_LABELS[s] ?? s).join(' · ')}을(를) 불러오지 못해 나머지 자료로 답했습니다.</p>
        )}
        {turn.citations.length > 0 && <Citations citations={turn.citations} numbers={numbers} flash={flash} onFocusSequence={onFocusSequence} />}
        {isLive && asOf && citationsDone && turn.status !== 'error' && turn.status !== 'cancelled' && (
          <p className="fine">
            콜 <span className="num">{formatCallClock(asOf.startMs)}</span> 시점까지의 내용으로 답했습니다. 그 뒤 발언은 반영하지 않았습니다.
          </p>
        )}
      </div>
    </article>
  )
}

function CiteChip({
  number,
  citation,
  citationsDone,
  onClick,
}: {
  number: number | undefined
  citation: AssistantCitation | undefined
  citationsDone: boolean
  onClick: () => void
}) {
  const weak = citationsDone && (!citation || citation.type === null || !citation.verified)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!citation}
      className={`cite ${weak ? 'weak' : ''}`}
      aria-label={`근거 ${number ?? ''}${!weak ? '' : !citation || citation.type === null ? ' — 근거 목록에 없는 표시' : ' — 수치를 원문에서 확인하지 못함'}`}
    >
      {number ?? '·'}
    </button>
  )
}

function Citations({
  citations,
  numbers,
  flash,
  onFocusSequence,
}: {
  citations: readonly AssistantCitation[]
  numbers: ReadonlyMap<string, number>
  flash: { marker: string; nonce: number } | null
  onFocusSequence: (sequence: number) => void
}) {
  const refs = useRef(new Map<string, HTMLLIElement>())
  useEffect(() => {
    if (flash) refs.current.get(flash.marker)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flash])
  return (
    <div className="src">
      <span className="src-k">근거</span>
      <ol>
        {citations.map((c) => {
          const weak = c.type === null || !c.verified
          const sequence = c.type === 'segment' ? segmentSequenceOf(c) : NaN
          return (
            <li
              key={c.marker}
              ref={(el) => {
                if (el) refs.current.set(c.marker, el)
                else refs.current.delete(c.marker)
              }}
              className={`src-i ${flash?.marker === c.marker ? 'on' : ''} ${weak ? 'weak' : ''}`}
            >
              <span className="src-n tnum">{numbers.get(c.marker)}</span>
              <div className="src-b">
                <span className="fine">
                  {citationKindLabel(c.type)}
                  {c.speaker && ` · ${c.speaker}`}
                  {c.type === 'segment' && c.startMs != null && (
                    <>
                      {' · '}
                      <span className="num">{formatCallClock(c.startMs)}</span>
                    </>
                  )}
                  {c.type !== 'segment' && c.source && ` · ${c.source}`}
                  {c.type !== 'segment' && c.publishedAt && ` · ${formatDate(c.publishedAt)}`}
                </span>
                {c.title && <span className="src-title">{c.title}</span>}
                {c.quote && <p className="src-quote">{c.quote}</p>}
                {weak && <span className="fine">{c.type === null ? '근거 목록에 없는 표시입니다' : '이 근거를 단 문장의 수치를 원문에서 확인하지 못했습니다'}</span>}
                {Number.isFinite(sequence) && (
                  <button type="button" className="link-btn" onClick={() => onFocusSequence(sequence)}>
                    자막에서 보기
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** 화면 키보드가 가린 높이(px). 키보드가 없으면 0. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

function Composer({
  streaming,
  remaining,
  locked,
  callId,
  onSend,
  onCancel,
  onNewConversation,
  onSpaceChange,
}: {
  streaming: boolean
  remaining: number
  locked: boolean
  callId: string
  onSend: (question: string) => void
  onCancel: () => void
  onNewConversation: () => void
  /** 입력칸이 화면 아래에서 덮는 높이(px). 키보드가 올라오면 키보드 높이를 더한다. */
  onSpaceChange: (px: number) => void
}) {
  const draft = useAssistantStore((s) => s.drafts[callId] ?? '')
  const setDraft = useAssistantStore((s) => s.setDraft)
  const keyboard = useKeyboardInset()
  // 쓰는 동안 탭 바가 숨는다. 키보드가 화면을 줄이는 브라우저(안드로이드)에서는 visualViewport 차이가 0 이라
  // 탭 바 자리에 붙어 있으면 키보드 위에 빈틈이 생긴다. 그래서 쓰는 동안은 아래 끝에 붙인다.
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = draft.trim()
  const tooLong = trimmed.length > MAX_QUESTION_CHARS
  const canSend = canSendQuestion({ streaming, locked, remaining, draft })

  // 입력칸 높이(줄 수에 따라 바뀜)와 키보드 높이를 재서 위에 알린다
  const boxRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const report = () => {
      const fromBottom = window.innerHeight - el.getBoundingClientRect().top
      onSpaceChange(Math.ceil(fromBottom) + 16)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [keyboard, typing, onSpaceChange])

  // 글 높이에 맞춰 늘린다(최대 네 줄, 넘치면 칸 안에서 스크롤)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 104)}px`
  }, [draft])

  const submit = () => {
    if (!canSend) return
    onSend(trimmed)
    setDraft(callId, '')
  }

  return (
    <div
      ref={boxRef}
      className="composer"
      style={keyboard > 0 ? { bottom: keyboard + 8 } : typing ? { bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      <p className="fine composer-note">{ASSISTANT_DISCLAIMER}</p>
      {remaining <= 0 && !streaming ? (
        <div className="composer-done cloud-s">
          <span>이 대화의 질문 {MAX_QUESTIONS_PER_CONVERSATION}개를 모두 썼습니다.</span>
          <button type="button" className="glass pill" onClick={onNewConversation}>
            새 대화
          </button>
        </div>
      ) : (
        <>
          <div className="inbox dent">
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(callId, e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => {
                if (isSubmitKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
                  e.preventDefault()
                  submit()
                }
              }}
              disabled={locked}
              placeholder={locked ? '오늘 질문 횟수를 모두 썼습니다' : '콜 내용에 대해 물어보세요'}
              aria-label="질문"
              enterKeyHint="send"
            />
            {streaming ? (
              <button type="button" className="send gb" onClick={onCancel} aria-label="답변 멈추기">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button type="button" className="send gb" disabled={!canSend} onClick={submit} aria-label="질문하기">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            )}
          </div>
          <span className="fine composer-count tnum">
            <span style={tooLong ? { color: 'var(--danger)' } : undefined}>
              {trimmed.length}/{MAX_QUESTION_CHARS}자
            </span>
          </span>
        </>
      )}
    </div>
  )
}

const NO_RETRY_CODES = new Set(['daily_limit_exceeded', 'auth_expired', 'validation', 'ticker_mismatch'])

/** 보낼 수 있는 질문인지. 공백뿐이거나 500자를 넘거나, 답을 받는 중 · 한도 · 질문 수를 다 쓴 경우는 보내지 않는다. */
export function canSendQuestion(s: { streaming: boolean; locked: boolean; remaining: number; draft: string }): boolean {
  const trimmed = s.draft.trim()
  return !s.streaming && !s.locked && s.remaining > 0 && trimmed.length > 0 && trimmed.length <= MAX_QUESTION_CHARS
}

/** Enter 는 보내기, Shift+Enter 는 줄바꿈. 한글 조합 중 Enter 는 글자를 확정하는 키라 보내지 않는다. */
export function isSubmitKey(e: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing
}

/** 콜 발언 근거의 발언 번호. ref 가 숫자면 그것, 아니면 표시(`S12`)에서. 모르면 NaN — `자막에서 보기` 를 두지 않는다. */
export function segmentSequenceOf(c: Pick<AssistantCitation, 'ref' | 'marker'>): number {
  const fromRef = c.ref != null && c.ref.trim() !== '' ? Number(c.ref) : NaN
  if (Number.isInteger(fromRef)) return fromRef
  const m = /^S(\d+)$/.exec(c.marker)
  return m ? Number(m[1]) : NaN
}

const STATUS_ANNOUNCE: Record<AssistantTurn['status'], string> = {
  pending: '답변을 준비하고 있습니다',
  streaming: '답변을 받는 중입니다',
  answered: '답변이 끝났습니다',
  no_evidence: '답변이 끝났습니다',
  refused: '답할 수 없는 질문입니다',
  error: '답변을 받지 못했습니다',
  cancelled: '질문을 취소했습니다',
}

/** 스트리밍 중에는 끝에 덜 온 근거 표시 · 강조 기호를 숨긴다(데스크톱과 같음). */
export function visibleText(turn: Pick<AssistantTurn, 'status' | 'text'>): string {
  return turn.status === 'streaming' ? turn.text.replace(/\[[A-Z]?\d*$/, '').replace(/(?<!\*)\*$/, '') : turn.text
}

const KST_TIME = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' })

export function formatResetAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '내일' : `${KST_TIME.format(d)}(한국 시간)`
}

function formatDate(sec: number): string {
  return DATE.format(new Date(sec * 1000))
}
