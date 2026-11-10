import type { GlossaryTerm } from '@terminal/renderer/store/useGlossaryStore'
import type { TranscriptDiffItem } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useFactCheckStore } from '@terminal/renderer/store/useFactCheckStore'
import { useSpeakerProfiles } from '@terminal/renderer/hooks/useSpeakerProfiles'
import { computeSpeakerStats, findProfileByLabel } from '@terminal/renderer/lib/speakerStats'
import { EMPTY_SPEAKER_STATS } from '@terminal/renderer/types/speakerProfile'
import { CHANGE_META, topicLabel } from '@terminal/renderer/components/call/diffMeta'
import { openSheet } from '../../app/sheet'
import { useCallData } from './useCallData'

/** 용어 시트 — 데스크톱 팝오버 내용: 번역어 · 원문 용어, 제목 없이 이어지는 설명(뜻, 이어서 어닝콜에서 알려 주는 것). */
export function openTermSheet(term: GlossaryTerm): void {
  openSheet({
    title: term.ko,
    subtitle: term.term,
    body: () => <p className="term-body">{[term.definitionKo, term.whyKo].filter(Boolean).join(' ')}</p>,
  })
}

/** 대조 상세 시트 — 직전 발언 · 이번 발언 원문을 나란히. 요약만 보이면 근거를 확인할 수 없다. */
export function openDiffSheet(item: TranscriptDiffItem): void {
  const meta = CHANGE_META[item.changeType]
  openSheet({
    title: (
      <span style={{ color: meta.color }}>
        {meta.symbol} {meta.label} · {topicLabel(item.topic)}
      </span>
    ),
    body: () => <DiffDetail item={item} />,
  })
}

export function DiffDetail({ item }: { item: TranscriptDiffItem }) {
  return (
    <div className="diff-detail">
      <p className="diff-sum">{item.summaryKo}</p>
      <div className="diff-quotes">
        <figure>
          <figcaption>직전 콜</figcaption>
          <blockquote>{item.priorClaim || '—'}</blockquote>
        </figure>
        <figure>
          <figcaption>이번 콜</figcaption>
          <blockquote>{item.currentClaim || '—'}</blockquote>
        </figure>
      </div>
      <p className="fine">
        신뢰 <span className="tnum">{Math.round(item.confidence * 100)}%</span> · 위험 <span className="tnum">{item.riskScore.toFixed(2)}</span>
      </p>
    </div>
  )
}

/** 화자 정보 시트 — 데스크톱 화자 프로필 내용(트랜스크립트에서 확인되는 사실 + 이번 회차 발언량). */
export function openSpeakerSheet(label: string): void {
  openSheet({ title: label.replace(/^[^·]+·\s*/, ''), body: () => <SpeakerBody label={label} /> })
}

function SpeakerBody({ label }: { label: string }) {
  const { ticker, segments, callId, phase } = useCallData()
  const profiles = useSpeakerProfiles(ticker)
  const claims = useFactCheckStore((s) => s.byTicker.get(ticker)?.claims ?? [])
  const profile = findProfileByLabel(profiles, label)
  if (!profile) {
    return <p>이 발화자의 명부 정보가 없습니다.</p>
  }
  const stats = computeSpeakerStats(profiles, segments, claims, callId).get(profile.matchKey) ?? EMPTY_SPEAKER_STATS
  return (
    <div className="speaker">
      <p className="speaker-role">
        <span className="speaker-kind">{profile.kind === 'ANALYST' ? '애널리스트' : '경영진'}</span>
        {[profile.title, profile.affiliation].filter(Boolean).join(' · ')}
      </p>
      <h3 className="speaker-k">이번 콜 발언</h3>
      {stats.segmentCount === 0 ? (
        <p>{phase === 'LIVE' ? '아직 발언이 도착하지 않았습니다.' : '재생된 발췌 구간에 이 참가자의 발언이 없습니다.'}</p>
      ) : (
        <dl className="speaker-stats">
          <div className="cloud-s">
            <dt>발언</dt>
            <dd className="tnum">{stats.segmentCount}건</dd>
          </div>
          <div className="cloud-s">
            <dt>단어</dt>
            <dd className="tnum">{stats.wordCount.toLocaleString('en-US')}</dd>
          </div>
          <div className="cloud-s">
            <dt>처음 · 마지막</dt>
            <dd className="num">
              {stats.firstTimestamp ?? '—'} · {stats.lastTimestamp ?? '—'}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
