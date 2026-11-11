import { countDiffsByType, formatCallClock } from '@terminal/renderer/lib/callScreen'
import { CHANGE_META, topicLabel } from '@terminal/renderer/components/call/diffMeta'
import type { TranscriptDiffChangeType } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useCallUi } from '../../app/callUi'
import type { CallData } from './useCallData'

/** 집계 네 칸 — 후퇴 · 개선 · 혼재 · 새 언급 (변화 없음은 목록에도 거의 오지 않아 칸을 두지 않는다). */
const COUNT_TYPES: TranscriptDiffChangeType[] = ['weakened', 'improved', 'mixed', 'new_claim']

/**
 * 대조. 기준 직전 콜 한 줄, 유형별 개수, 발언 순서 목록. 항목을 누르면 자막으로 바꾸고 그 발언을 밝힌다.
 * 데스크톱 CallSideTabs 의 대조 탭과 같은 내용이다.
 */
export default function DiffTab({ data }: { data: CallData }) {
  const focusSequence = useCallUi((s) => s.focusSequence)
  const counts = countDiffsByType(data.diffItems)
  const startBySeq = new Map(data.segments.map((s) => [s.sequence, s.startMs]))
  const items = [...data.diffItems].sort((a, b) => a.sequence - b.sequence)

  return (
    <div className="stack-10">
      <p className="diff-base">
        {data.previousCall?.fiscalQuarter ? `${data.previousCall.fiscalQuarter} 콜과 비교` : '첫 대조가 오면 비교 대상 직전 콜을 표시합니다'}
      </p>
      <ul className="counts" aria-label="변화 유형별 개수">
        {COUNT_TYPES.map((t) => (
          <li key={t} className="cloud-s">
            <b className="tnum" style={{ color: CHANGE_META[t].color }}>
              {counts[t]}
            </b>
            {CHANGE_META[t].symbol} {CHANGE_META[t].label}
          </li>
        ))}
      </ul>
      {items.length === 0 ? (
        <p className="cloud panel state">
          {data.phase === 'LIVE' ? '아직 직전 콜과 달라진 발언이 없습니다. 생기면 여기에 쌓입니다.' : '직전 콜과 대조한 발언이 없습니다.'}
        </p>
      ) : (
        <ol className="dl cloud rows">
          {items.map((d, i) => {
            const meta = CHANGE_META[d.changeType]
            const start = startBySeq.get(d.sequence)
            return (
              <li key={`${d.sequence}-${i}`}>
                <button type="button" className="row-btn dl-i" onClick={() => focusSequence(d.sequence)}>
                  <span className="dl-top">
                    <span className="num tm">{start != null ? formatCallClock(start) : '—'}</span>
                    <b style={{ color: meta.color }}>
                      {meta.symbol} {meta.label}
                    </b>
                    <span>{topicLabel(d.topic)}</span>
                  </span>
                  <span className="dl-sum">{d.summaryKo}</span>
                  <span className="sr-only">자막에서 보기</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
