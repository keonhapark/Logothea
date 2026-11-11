import { describe, it, expect } from 'vitest'
import {
  computeViewportIndicator,
  countDiffsByType,
  countdownParts,
  currentCallSegments,
  deriveCallPhase,
  epsBulletDomain,
  epsBulletRatio,
  formatCallClock,
  groupDiffsBySequence,
  isProminentDiff,
  maxOrderQty,
  timelineMarks,
  translationsByLastSequence,
} from '../callScreen'
import type { TranscriptSegment } from '../../store/useTranscriptStore'
import type { TranscriptDiffItem } from '../../store/useTranscriptDiffStore'

function seg(sequence: number, callId = 'WMT-Q2'): TranscriptSegment {
  return { ticker: 'WMT', callId, sequence, startMs: sequence * 15000, endMs: sequence * 15000 + 14000, text: `s${sequence}`, timestamp: 1 }
}

function diff(overrides: Partial<TranscriptDiffItem> = {}): TranscriptDiffItem {
  return {
    topic: 'demand',
    changeType: 'improved',
    summaryKo: '요약',
    currentClaim: 'now',
    priorClaim: 'before',
    confidence: 0.8,
    riskScore: 0.2,
    evidence: [],
    sequence: 1,
    ...overrides,
  }
}

describe('deriveCallPhase', () => {
  it('자막이 없으면 시작 전이다', () => {
    expect(deriveCallPhase([], new Set(), undefined)).toBe('BEFORE')
  })

  it('마지막 콜이 종료 표시를 받지 않았으면 진행 중이다', () => {
    expect(deriveCallPhase([seg(0), seg(1)], new Set(), undefined)).toBe('LIVE')
  })

  it('마지막 콜이 종료 표시를 받았으면 종료 후다', () => {
    expect(deriveCallPhase([seg(0)], new Set(['WMT-Q2']), undefined)).toBe('ENDED')
  })

  it('지난 회차만 종료됐고 새 회차가 진행 중이면 진행 중이다', () => {
    expect(deriveCallPhase([seg(0, 'old'), seg(0, 'new')], new Set(['old']), undefined)).toBe('LIVE')
  })

  it('이번 콜의 종합 판단이 도착했으면 종료 표시를 놓쳤어도 종료 후다', () => {
    expect(deriveCallPhase([seg(0)], new Set(), 'WMT-Q2')).toBe('ENDED')
    expect(deriveCallPhase([], new Set(), 'WMT-Q2')).toBe('ENDED')
  })

  it('callId 가 없는 판단은 지금 콜의 것으로 본다', () => {
    expect(deriveCallPhase([seg(0)], new Set(), null)).toBe('ENDED')
  })

  it('지난 회차 판단은 진행 중인 새 콜을 종료 후로 바꾸지 않는다', () => {
    expect(deriveCallPhase([seg(0, 'new')], new Set(), 'old')).toBe('LIVE')
  })
})

describe('currentCallSegments', () => {
  it('가장 최근 콜의 자막만 남긴다', () => {
    const out = currentCallSegments([seg(0, 'old'), seg(1, 'old'), seg(0, 'new')])
    expect(out.map((s) => s.callId)).toEqual(['new'])
  })

  it('한 콜뿐이면 같은 배열을 돌려준다', () => {
    const input = [seg(0), seg(1)]
    expect(currentCallSegments(input)).toBe(input)
  })
})

describe('isProminentDiff', () => {
  it('후퇴는 위험 점수와 관계없이 펼친다', () => {
    expect(isProminentDiff(diff({ changeType: 'weakened', riskScore: 0 }))).toBe(true)
  })

  it('위험 점수가 기준(0.7) 이상이면 펼친다', () => {
    expect(isProminentDiff(diff({ riskScore: 0.7 }))).toBe(true)
    expect(isProminentDiff(diff({ riskScore: 0.69 }))).toBe(false)
  })
})

describe('groupDiffsBySequence', () => {
  it('같은 발언의 항목을 도착 순서대로 묶는다', () => {
    const a = diff({ sequence: 3, topic: 'a' })
    const b = diff({ sequence: 5, topic: 'b' })
    const c = diff({ sequence: 3, topic: 'c' })
    const map = groupDiffsBySequence([a, b, c])
    expect(map.get(3)).toEqual([a, c])
    expect(map.get(5)).toEqual([b])
    expect(map.get(4)).toBeUndefined()
  })
})

describe('countDiffsByType', () => {
  it('변화 유형마다 센다', () => {
    const counts = countDiffsByType([diff(), diff({ changeType: 'weakened' }), diff()])
    expect(counts).toEqual({ improved: 2, weakened: 1, unchanged: 0, mixed: 0, new_claim: 0 })
  })
})

describe('maxOrderQty', () => {
  it('매수는 예수금을 주문 단가로 나눈 몫이다', () => {
    expect(maxOrderQty({ side: 'BUY', unitPrice: 98.37, orderableCash: 1000, heldQty: 0 })).toBe(10)
  })

  it('매도는 보유 수량이다', () => {
    expect(maxOrderQty({ side: 'SELL', unitPrice: 98, orderableCash: 0, heldQty: 7 })).toBe(7)
  })

  it('가격이나 잔고를 모르면 null 이다', () => {
    expect(maxOrderQty({ side: 'BUY', unitPrice: null, orderableCash: 1000, heldQty: 0 })).toBeNull()
    expect(maxOrderQty({ side: 'SELL', unitPrice: 98, orderableCash: 0, heldQty: null })).toBeNull()
  })

  it('예수금이 없으면 0 이다', () => {
    expect(maxOrderQty({ side: 'BUY', unitPrice: 98, orderableCash: 0, heldQty: 0 })).toBe(0)
  })
})

describe('formatCallClock', () => {
  it('한 시간 미만은 mm:ss, 넘으면 h:mm:ss 다', () => {
    expect(formatCallClock(125_000)).toBe('02:05')
    expect(formatCallClock(3_725_000)).toBe('1:02:05')
  })

  it('음수와 NaN 은 00:00 이다', () => {
    expect(formatCallClock(-1)).toBe('00:00')
    expect(formatCallClock(Number.NaN)).toBe('00:00')
  })
})

describe('countdownParts', () => {
  it('남은 시간을 일 · 시 · 분 · 초로 나눈다', () => {
    const now = 1_000_000
    const at = (now + (1 * 86400 + 2 * 3600 + 3 * 60 + 4) * 1000) / 1000
    expect(countdownParts(at, now)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 })
  })

  it('예정 시각이 지났으면 null 이다', () => {
    expect(countdownParts(1000, 1000 * 1000)).toBeNull()
  })
})

describe('translationsByLastSequence', () => {
  const tr = (callId: string, sequences: number[]) => ({ callId, sequences, textKo: 't' })

  it('문단을 마지막 발언 번호에 붙인다', () => {
    const a = tr('WMT-Q2', [0, 1, 2])
    const b = tr('WMT-Q2', [3, 4, 5])
    const map = translationsByLastSequence([a, b], 'WMT-Q2')
    expect(map.get(2)).toBe(a)
    expect(map.get(5)).toBe(b)
    expect(map.get(0)).toBeUndefined()
  })

  it('지난 회차 번역은 버린다', () => {
    const map = translationsByLastSequence([tr('old', [0, 1, 2]), tr('new', [0])], 'new')
    expect(map.get(2)).toBeUndefined()
    expect(map.get(0)?.callId).toBe('new')
  })

  it('지금 콜을 모르면 비어 있다', () => {
    expect(translationsByLastSequence([tr('a', [0])], null).size).toBe(0)
  })
})

describe('epsBulletDomain', () => {
  it('값이 없으면 null', () => {
    expect(epsBulletDomain([])).toBeNull()
    expect(epsBulletDomain([null, Number.NaN])).toBeNull()
  })

  it('최솟값 아래로 여유를 두어 몇 센트 차이도 막대 길이로 갈린다', () => {
    const domain = epsBulletDomain([0.65, 0.69, 0.64, 0.66, 0.58, 0.6])!
    expect(domain[0]).toBeLessThan(0.58)
    expect(domain[1]).toBeGreaterThan(0.69)
    expect(epsBulletRatio(0.69, domain) - epsBulletRatio(0.65, domain)).toBeGreaterThan(0.2)
  })

  it('값이 모두 같아도 범위가 0 이 되지 않는다', () => {
    const [lo, hi] = epsBulletDomain([0.5, 0.5])!
    expect(hi).toBeGreaterThan(lo)
    const [lo0, hi0] = epsBulletDomain([0, 0])!
    expect(hi0).toBeGreaterThan(lo0)
  })

  it('음수 EPS 도 다룬다', () => {
    const domain = epsBulletDomain([-0.2, -0.1])!
    expect(epsBulletRatio(-0.1, domain)).toBeGreaterThan(epsBulletRatio(-0.2, domain))
  })
})

describe('epsBulletRatio', () => {
  it('범위를 벗어나면 양 끝에 붙인다', () => {
    expect(epsBulletRatio(-5, [0, 1])).toBe(0)
    expect(epsBulletRatio(5, [0, 1])).toBe(1)
    expect(epsBulletRatio(0.25, [0, 1])).toBe(0.25)
  })
})

describe('timelineMarks', () => {
  it('자막이 없으면 점도 축 길이도 없다', () => {
    expect(timelineMarks([], [diff({ sequence: 1 })])).toEqual({ totalMs: 0, marks: [] })
  })

  it('축은 마지막 발언 끝까지이고, 점은 그 발언의 시작 시각 비율에 놓인다', () => {
    const segs = [seg(0), seg(1), seg(2), seg(3)] // 마지막 끝 = 59000
    const { totalMs, marks } = timelineMarks(segs, [diff({ sequence: 2 })])
    expect(totalMs).toBe(59000)
    expect(marks).toHaveLength(1)
    expect(marks[0].startMs).toBe(30000)
    expect(marks[0].ratio).toBeCloseTo(30000 / 59000)
  })

  it('첫 발언의 대조는 왼쪽 끝(0)에 놓인다', () => {
    const { marks } = timelineMarks([seg(0), seg(1)], [diff({ sequence: 0 })])
    expect(marks[0].ratio).toBe(0)
  })

  it('보이는 자막에 없는 발언의 대조는 찍지 않는다', () => {
    const { marks } = timelineMarks([seg(0), seg(1)], [diff({ sequence: 1 }), diff({ sequence: 7 })])
    expect(marks.map((m) => m.sequence)).toEqual([1])
  })

  it('같은 발언의 대조는 한 점으로 묶고 도착 순서를 지킨다', () => {
    const a = diff({ sequence: 1, topic: 'margin' })
    const b = diff({ sequence: 1, topic: 'demand' })
    const { marks } = timelineMarks([seg(0), seg(1)], [a, b])
    expect(marks).toHaveLength(1)
    expect(marks[0].items).toEqual([a, b])
    expect(marks[0].lead).toBe(a)
  })

  it('묶인 점의 대표는 후퇴 · 고위험 항목이다', () => {
    const a = diff({ sequence: 1, changeType: 'improved' })
    const b = diff({ sequence: 1, changeType: 'weakened' })
    const { marks } = timelineMarks([seg(0), seg(1)], [a, b])
    expect(marks[0].lead).toBe(b)
  })

  it('점은 도착 순서가 아니라 시각 순으로 놓인다', () => {
    const { marks } = timelineMarks([seg(0), seg(1), seg(2)], [diff({ sequence: 2 }), diff({ sequence: 0 })])
    expect(marks.map((m) => m.sequence)).toEqual([0, 2])
  })
})

describe('computeViewportIndicator', () => {
  it('스크롤 영역이 뷰포트 이하이면 전체(0~100%)를 반환한다', () => {
    expect(computeViewportIndicator(0, 500, 500)).toEqual({ topPercent: 0, heightPercent: 100 })
    expect(computeViewportIndicator(0, 600, 400)).toEqual({ topPercent: 0, heightPercent: 100 })
    expect(computeViewportIndicator(0, 0, 0)).toEqual({ topPercent: 0, heightPercent: 100 })
  })

  it('맨 위에 있을 때(scrollTop=0) topPercent 는 0이고 높이는 뷰포트 비율이다', () => {
    // clientHeight 500, scrollHeight 1000 => heightPercent 50%
    const res = computeViewportIndicator(0, 500, 1000)
    expect(res.topPercent).toBe(0)
    expect(res.heightPercent).toBe(50)
  })

  it('맨 아래에 있을 때 topPercent + heightPercent 는 100% 이다', () => {
    // clientHeight 400, scrollHeight 1000, maxScroll = 600
    const res = computeViewportIndicator(600, 400, 1000)
    expect(res.heightPercent).toBe(40)
    expect(res.topPercent).toBe(60)
    expect(res.topPercent + res.heightPercent).toBe(100)
  })

  it('중간 스크롤 위치에서 비율에 맞게 topPercent 가 계산된다', () => {
    // clientHeight 400, scrollHeight 1000, scrollTop = 300 (50% scrolled)
    const res = computeViewportIndicator(300, 400, 1000)
    expect(res.heightPercent).toBe(40)
    expect(res.topPercent).toBe(30)
  })

  it('스크롤 높이가 매우 길 때도 minHeightRatio 최소 높이를 보장한다', () => {
    // clientHeight 100, scrollHeight 10000 => raw ratio 1%, but min 8%
    const res = computeViewportIndicator(0, 100, 10000, 0.08)
    expect(res.heightPercent).toBe(8)
    expect(res.topPercent).toBe(0)

    // scrolled to bottom
    const resBottom = computeViewportIndicator(9900, 100, 10000, 0.08)
    expect(resBottom.heightPercent).toBe(8)
    expect(resBottom.topPercent + resBottom.heightPercent).toBeCloseTo(100)
  })
})
