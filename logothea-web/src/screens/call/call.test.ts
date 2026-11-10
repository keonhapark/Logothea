import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '@terminal/renderer/store/useTranscriptStore'
import type { TranscriptDiffItem } from '@terminal/renderer/store/useTranscriptDiffStore'
import type { EarningsSummary } from '@terminal/renderer/types/earningsSummary'
import { buildCallData, type CallSources } from './useCallData'
import { isNewRound } from '../../app/callFeed'
import { formatResetAt, visibleText } from './AskTab'
import { waitStartFor, waitStepIndex } from './VerdictTab'

const seg = (callId: string, sequence: number): TranscriptSegment => ({
  ticker: 'WMT', callId, sequence, startMs: sequence * 1000, endMs: sequence * 1000 + 900, text: `s${sequence}`, timestamp: sequence,
})
const diff = (sequence: number, changeType: TranscriptDiffItem['changeType'] = 'improved'): TranscriptDiffItem => ({
  topic: 'demand', changeType, summaryKo: '', currentClaim: '', priorClaim: '', confidence: 0.5, riskScore: 0.1, evidence: [], sequence,
})
const summary = (callId: string | null) => ({ ticker: 'WMT', callId } as unknown as EarningsSummary)

function sources(over: Partial<CallSources> = {}): CallSources {
  return { segments: [], endedCallIds: new Set(), diffItems: [], previousCall: null, summary: null, translations: [], glossaryStatus: 'ready', ...over }
}

describe('buildCallData', () => {
  it('가장 최근 회차의 자막만 쓰고, 진행 중이면 LIVE', () => {
    const d = buildCallData(sources({ segments: [seg('c1', 0), seg('c1', 1), seg('c2', 0)] }))
    expect(d.callId).toBe('c2')
    expect(d.segments.map((s) => s.sequence)).toEqual([0])
    expect(d.phase).toBe('LIVE')
  })

  it('종료 표시를 받았으면 ENDED', () => {
    expect(buildCallData(sources({ segments: [seg('c1', 0)], endedCallIds: new Set(['c1']) })).phase).toBe('ENDED')
  })

  it('지금 회차의 판단이면 summary, 지난 회차 판단이면 previousSummary 로 가르고 상태를 정하는 데 쓰지 않는다', () => {
    const current = buildCallData(sources({ segments: [seg('c2', 0)], summary: summary('c2') }))
    expect(current.summary?.callId).toBe('c2')
    expect(current.previousSummary).toBeNull()
    expect(current.phase).toBe('ENDED')

    const previous = buildCallData(sources({ segments: [seg('c2', 0)], summary: summary('c1') }))
    expect(previous.summary).toBeNull()
    expect(previous.previousSummary?.callId).toBe('c1')
    expect(previous.phase).toBe('LIVE')
  })

  it('회차를 모르는 판단(callId 없음)은 지금 회차의 것으로 본다', () => {
    expect(buildCallData(sources({ segments: [seg('c1', 0)], summary: summary(null) })).summary).not.toBeNull()
  })

  it('보이는 자막에 없는 발언의 대조는 버리고, 같은 발언끼리 묶는다', () => {
    const d = buildCallData(sources({ segments: [seg('c1', 0), seg('c1', 1)], diffItems: [diff(1), diff(1, 'weakened'), diff(7)] }))
    expect(d.diffItems.map((x) => x.sequence)).toEqual([1, 1])
    expect(d.diffsBySequence.get(1)).toHaveLength(2)
  })

  it('번역은 지금 회차 것만 마지막 발언 번호로 묶는다', () => {
    const tr = (callId: string, sequences: number[]) => ({ callId, sequences, textKo: 'x', termsUsed: [], spans: [] })
    const d = buildCallData(sources({ segments: [seg('c2', 0), seg('c2', 1)], translations: [tr('c1', [0]), tr('c2', [0, 1])] }))
    expect([...d.translations.keys()]).toEqual([1])
  })
})

describe('isNewRound', () => {
  it('처음 본 회차(중간 입장)는 새 회차가 아니고, 회차가 바뀌면 새 회차', () => {
    expect(isNewRound(null, 'c1')).toBe(false)
    expect(isNewRound('c1', 'c1')).toBe(false)
    expect(isNewRound('c1', 'c2')).toBe(true)
    expect(isNewRound('c1', null)).toBe(false)
  })
})

describe('질문 표시', () => {
  it('스트리밍 중에는 끝의 덜 온 근거 표시 · 강조 기호를 숨긴다', () => {
    expect(visibleText({ status: 'streaming', text: '매출이 늘었습니다 [S1' })).toBe('매출이 늘었습니다 ')
    expect(visibleText({ status: 'streaming', text: '**강조*' })).toBe('**강조')
    expect(visibleText({ status: 'answered', text: '끝 [S1' })).toBe('끝 [S1')
  })

  it('한도 초기화 시각을 한국 시간으로 쓰고, 읽을 수 없으면 내일', () => {
    expect(formatResetAt('2026-11-11T15:00:00Z')).toContain('(한국 시간)')
    expect(formatResetAt('nope')).toBe('내일')
  })
})

describe('판단 대기', () => {
  it('지난 시간으로 단계를 넘긴다(12초 · 30초)', () => {
    expect(waitStepIndex(0)).toBe(0)
    expect(waitStepIndex(12)).toBe(1)
    expect(waitStepIndex(29)).toBe(1)
    expect(waitStepIndex(30)).toBe(2)
    expect(waitStepIndex(9999)).toBe(2)
  })

  it('기다린 시각을 회차별로 기억해 탭을 오가도 이어 센다', () => {
    expect(waitStartFor('call-x', 1000)).toBe(1000)
    expect(waitStartFor('call-x', 5000)).toBe(1000)
    expect(waitStartFor('call-y', 5000)).toBe(5000)
    expect(waitStartFor(null, 7000)).toBe(7000)
  })
})

import { canSendQuestion, isSubmitKey, segmentSequenceOf } from './AskTab'
import { speakerLayout } from './TranscriptTab'
import { isRetiredPayload, retireCall, trackRound } from '../../app/callFeed'
import { resetCallRound } from '../../app/broadcast'
import { useCallUi } from '../../app/callUi'
import { useTranscriptDiffStore } from '@terminal/renderer/store/useTranscriptDiffStore'

describe('buildCallData — 자막 없이 판단만', () => {
  it('콜이 끝난 뒤 들어와 자막이 없어도 판단을 지금 것으로 보고 ENDED', () => {
    const d = buildCallData(sources({ summary: summary('c1') }))
    expect(d.summary).not.toBeNull()
    expect(d.previousSummary).toBeNull()
    expect(d.phase).toBe('ENDED')
  })
})

describe('trackRound', () => {
  it('자막이 잠깐 비어도 마지막 회차를 잊지 않아, c1 → 없음 → c2 에서 비운다', () => {
    let seen: string | null = null
    const steps: [string | null, boolean][] = [['c1', false], [null, false], ['c2', true], ['c2', false]]
    for (const [latest, reset] of steps) {
      const r = trackRound(seen, latest)
      expect(r.reset).toBe(reset)
      if (reset) expect(r.retired).toBe('c1')
      seen = r.seen
    }
  })
})

describe('resetCallRound', () => {
  it('지난 회차의 대조를 비우고 범위 · 밝힘을 버리되 고른 탭은 둔다', () => {
    useTranscriptDiffStore.getState().upsertDiff({
      ticker: 'WMT', call_id: 'c1', sequence: 0,
      previous_document: { document_id: 'p', title: 't', published_at: '', fiscal_quarter: 'Q1', source_url: '' },
      items: [{ topic: 'demand', change_type: 'improved', summary_ko: 'x', current_claim: 'a', prior_claim: 'b', confidence: 0.5, risk_score: 0.1, evidence: [] }],
    })
    useCallUi.setState({ tab: 'diff', anchorSequence: 3, focus: { sequence: 1, nonce: 1 } })
    resetCallRound('c1')
    expect(useTranscriptDiffStore.getState().byTicker.get('WMT')?.items ?? []).toHaveLength(0)
    expect(useCallUi.getState()).toMatchObject({ tab: 'diff', anchorSequence: null, focus: null })
    expect(isRetiredPayload({ call_id: 'c1' })).toBe(true)
  })

  it('끝난 회차의 늦은 대조만 버리고 다른 회차 · 회차 없는 메시지는 통과시킨다', () => {
    retireCall('old')
    expect(isRetiredPayload({ call_id: 'old' })).toBe(true)
    expect(isRetiredPayload({ call_id: 'new' })).toBe(false)
    expect(isRetiredPayload({})).toBe(false)
    expect(isRetiredPayload(null)).toBe(false)
  })
})

describe('speakerLayout', () => {
  const s = (speaker: string | undefined, sequence = 0) => ({ ...seg('c1', sequence), speaker })
  it('같은 사람이 이어 말하면 이름을 숨기고, 앞 발언에 번역 · 대조가 없을 때만 간격을 좁힌다', () => {
    expect(speakerLayout(undefined, s('A'), false)).toEqual({ showName: true, pullUp: false })
    expect(speakerLayout(s('A'), s('A', 1), false)).toEqual({ showName: false, pullUp: true })
    expect(speakerLayout(s('A'), s('A', 1), true)).toEqual({ showName: false, pullUp: false })
    expect(speakerLayout(s('A'), s('B', 1), false)).toEqual({ showName: true, pullUp: false })
    expect(speakerLayout(s(undefined), s(undefined, 1), false)).toEqual({ showName: false, pullUp: false })
  })
})

describe('질문 보내기 규칙', () => {
  const base = { streaming: false, locked: false, remaining: 3, draft: '가이던스는?' }
  it.each([
    [{}, true],
    [{ draft: '   ' }, false],
    [{ draft: 'x'.repeat(501) }, false],
    [{ draft: ` ${'x'.repeat(500)} ` }, true],
    [{ streaming: true }, false],
    [{ locked: true }, false],
    [{ remaining: 0 }, false],
  ])('%j → %s', (over, ok) => {
    expect(canSendQuestion({ ...base, ...over })).toBe(ok)
  })

  it('Enter 는 보내고, Shift+Enter · 한글 조합 중 Enter 는 보내지 않는다', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(isSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(isSubmitKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
  })
})

describe('segmentSequenceOf', () => {
  it.each([
    [{ ref: '12', marker: 'S3' }, 12],
    [{ ref: '', marker: 'S3' }, 3],
    [{ ref: null, marker: 'S7' }, 7],
    [{ ref: 'abc', marker: 'N1' }, Number.NaN],
  ])('%j → %s (빈 ref 를 0 번 발언으로 보지 않는다)', (c, expected) => {
    expect(segmentSequenceOf(c)).toBe(expected)
  })
})

import { describeBand } from './RiskBands'

describe('describeBand (손절 · 익절 띠 설명)', () => {
  it('기준가에서 얼마나 위 · 아래인지 쓰고, 손절은 계획을 접는 조건을 덧붙인다', () => {
    expect(describeBand({ key: 'stop', price: 101.4, diff: 2.98 }, '기준가', 3)).toBe(
      '손절 $101.40 · 기준가보다 $2.98(+3.0%) 위. 종가가 여기를 넘어가면 계획을 접습니다.',
    )
    expect(describeBand({ key: 'tp1', price: 95, diff: -3.42 }, '최근 종가', -3.5)).toBe('1차 익절 $95.00 · 최근 종가보다 $3.42(−3.5%) 아래.')
  })
})
