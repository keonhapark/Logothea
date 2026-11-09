import { useEffect, useState, type ReactNode } from 'react'
import type { EarningsSummary, ImpactDirection, SignalDirection } from '../../types/earningsSummary'
import type { TranscriptDiffChangeType } from '../../store/useTranscriptDiffStore'
import { CHANGE_META, CHANGE_ORDER } from './diffMeta'
import ScrollEdge from './ScrollEdge'
import { catalystLabel } from '../../lib/catalystLabel'

interface CallVerdictProps {
  summary: EarningsSummary | null
  diffCounts: Record<TranscriptDiffChangeType, number>
  previousCallLabel: string | null
  /** 파급 영향 종목을 누르면 그 종목 브리핑을 연다. */
  onOpenTicker: (ticker: string) => void
  /** 시연을 중지해 판단이 오지 않는 콜. 대기 대신 중지했다고 알린다. */
  demoStopped?: boolean
  topInset: number
}

/** 판단이 오지 않을 때 대기 문구를 무한히 두지 않고 안내로 바꾸는 시간. */
export const SUMMARY_WAIT_LIMIT_MS = 3 * 60 * 1000

const DIRECTION_LABELS: Record<SignalDirection, string> = {
  BULLISH: '강세',
  BEARISH: '약세',
  NEUTRAL: '중립',
}

/** 실행 게이트의 `action` — 방향이 아니라 실행 허용 여부다. "매수/매도" 로 읽히지 않게 옮긴다. */
const ACTION_LABELS: Record<string, string> = {
  AVOID: '실행 보류',
  HOLD: '관망',
  BUY: '진입 가능',
  SELL: '청산 우선',
  WATCH: '관찰',
}

/** 실행 조건 — 통과는 올리브, 조건부 보류는 ink-2, 차단은 포르피라 글자 (design-system 종합 판단). */
const GATE_META: Record<string, { label: string; color: string }> = {
  pass: { label: '통과', color: 'var(--olive-ink)' },
  soft_block: { label: '조건부 보류', color: 'var(--ink-2)' },
  hard_block: { label: '차단', color: 'var(--porphyra-ink)' },
}

/**
 * 엔진의 관계 표기 → 한국어. 엔진은 영어 문구로 보낸다(ai-engine earnings_intelligence_service).
 * 모르는 문구는 그대로 둔다.
 */
const RELATIONSHIP_LABELS: Record<string, string> = {
  'user-supplied related ticker': '관련 종목',
  'broad market ETF': '시장 ETF',
  'large-cap growth ETF': '대형 성장주 ETF',
  'GPU peer': 'GPU 경쟁사',
  'foundry supplier': '파운드리 공급사',
  'AI networking peer': 'AI 네트워크 경쟁사',
  'HBM memory supplier': 'HBM 공급사',
  'AI server supply-chain': 'AI 서버 공급망',
  'cloud/AI peer': '클라우드 · AI 경쟁사',
  'cloud peer': '클라우드 경쟁사',
  'AI capex peer': 'AI 투자 경쟁사',
  'enterprise cloud peer': '기업용 클라우드 경쟁사',
  'digital ads peer': '디지털 광고 경쟁사',
  'social ads peer': '소셜 광고 경쟁사',
  'AI infrastructure supplier': 'AI 인프라 공급사',
  'EV peer': '전기차 경쟁사',
  'auto peer': '자동차 경쟁사',
  'battery material exposure': '배터리 소재',
  'component supplier': '부품 공급사',
  'wireless component supplier': '무선 부품 공급사',
}

const IMPACT_LABELS: Record<ImpactDirection, string> = {
  positive: '수혜',
  negative: '부정',
  mixed: '혼재',
  neutral: '중립',
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

function money(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}`
}

function signedPct(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
}

/**
 * 종합 판단 — 콜 종료 후 콜 화면의 주인공 (docs/design/ux.md 콜 종료 후 판단).
 *
 *  - 첫 줄은 방향(강세 · 약세)이 아니라 실행 판단이다. `강세` 와 `실행 보류` 가 함께 나오는 일이 정상인데,
 *    방향만 크게 보이면 바로 사도 된다는 신호로 오해한다.
 *  - 방향은 색 없이 글자로만 쓴다. 상승 · 하락 색과 섞이지 않게 하기 위해서다.
 *  - 근거 · 반대 논거 · 질문 회피 · 파급 영향 · 손절 계획은 펼쳐 본다.
 *  - 없는 값을 0 으로 채우지 않고, 엔진 경고와 부가 정보 누락도 감추지 않는다.
 */
export default function CallVerdict({ summary, diffCounts, previousCallLabel, onOpenTicker, demoStopped = false, topInset }: CallVerdictProps) {
  return (
    <section className="cloud relative h-full rounded-[28px] overflow-hidden" aria-label="종합 판단">
      <ScrollEdge height={topInset + 12} />
      {/* 위쪽에 판단 / 질문 전환이 떠 있어, 본문이 그 아래로 지나가면 글자가 겹친다. 스크롤 영역을 전환 아래에서 시작한다 */}
      <div className="absolute inset-x-0 bottom-0 overflow-y-auto" style={{ top: topInset }}>
        <div className="px-8 pt-4 pb-10 flex flex-col gap-6 max-w-[820px]">
          {summary ? (
            <Verdict summary={summary} onOpenTicker={onOpenTicker} />
          ) : demoStopped ? (
            <div className="flex flex-col gap-2" role="status">
              <span className="text-[13px] text-ink-3">종합 판단</span>
              <span className="text-[22px] font-bold text-ink-1">시연을 중지했습니다</span>
              <span className="text-[13px] text-ink-3">끝까지 재생하지 않은 콜은 종합 판단을 만들지 않습니다. 콜 바의 처음부터로 다시 재생할 수 있습니다.</span>
            </div>
          ) : (
            <Waiting />
          )}
          <DiffSummary counts={diffCounts} previousCallLabel={previousCallLabel} />
        </div>
      </div>
    </section>
  )
}

function Waiting() {
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), SUMMARY_WAIT_LIMIT_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex flex-col gap-2" role="status">
      <span className="text-[13px] text-ink-3">종합 판단</span>
      {timedOut ? (
        <>
          <span className="text-[22px] font-bold text-ink-1">종합 판단을 받지 못했습니다</span>
          <span className="text-[13px] text-ink-3 leading-relaxed">
            콜이 끝나고 3분이 지나도 판단이 오지 않았습니다. 판단은 회차마다 한 번만 오기 때문에 다시 받으려면
            시연을 처음부터 재생해야 합니다. 판단 재요청은 준비 중입니다.
          </span>
        </>
      ) : (
        <>
          <span className="text-[22px] font-bold text-ink-1">콜 전체를 종합하는 중입니다</span>
          <span className="text-[13px] text-ink-3">콜이 끝나면 전문을 다시 읽고 판단을 만듭니다.</span>
        </>
      )}
    </div>
  )
}

function Verdict({ summary, onOpenTicker }: { summary: EarningsSummary; onOpenTicker: (t: string) => void }) {
  const { judgment, gate, evasion, impactChain, riskPlan, warnings } = summary
  const action = gate?.action ? ACTION_LABELS[gate.action] ?? gate.action : null
  const gateMeta = gate?.gateResult ? GATE_META[gate.gateResult] ?? { label: gate.gateResult, color: 'var(--ink-2)' } : null
  const catalyst = judgment.catalystType ? catalystLabel(judgment.catalystType) : null
  const counterItems = [
    ...(gate?.counterThesisKo ? [gate.counterThesisKo] : []),
    ...(gate?.riskFlagsKo ?? []),
  ]

  return (
    <>
      {/* 실행 판단 — 판단의 첫 줄 */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-ink-3">실행 판단</span>
        {action ? (
          <span className="text-[24px] font-bold leading-tight text-ink-1">
            {action}
            {gateMeta && (
              <span className="text-[18px] font-semibold" style={{ color: gateMeta.color }}>
                {' '}· {gateMeta.label}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[18px] font-semibold text-ink-2">실행 판단이 오지 않았습니다 · 방향만 참고하세요</span>
        )}
        {gate?.positionIntentKo && <p className="text-[14.5px] text-ink-1 leading-relaxed">{gate.positionIntentKo}</p>}
        {gate?.noTradeSummaryKo && (
          <p className="text-[13.5px] text-ink-2 leading-relaxed">보류 사유 · {gate.noTradeSummaryKo}</p>
        )}
      </div>

      {/* 방향 — 실행 판단의 근거. 색 없이 글자로만 */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-8 gap-y-3 items-start border-t border-border-subtle pt-5">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">방향</span>
          <span className="text-[18px] font-semibold text-ink-1">{DIRECTION_LABELS[judgment.direction]}</span>
          {catalyst && <span className="text-[12.5px] text-ink-3">{catalyst}</span>}
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <Meter label="강도" value={judgment.magnitude} />
          <Meter label="신뢰도" value={judgment.confidence} />
        </div>
        {gate?.institutionalGrade && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[12px] text-ink-3">기관 등급</span>
            <span className="tabular-nums text-[18px] font-semibold text-ink-1">
              {gate.institutionalGrade}
              {gate.institutionalGradeScore !== null && (
                <span className="text-[13px] text-ink-3 font-normal"> · {Math.round(gate.institutionalGradeScore)}</span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {judgment.rationale && (
          <Fold title="판단 근거" hint="영어 원문">
            <p className="text-[13px] text-ink-2 leading-relaxed select-text">{judgment.rationale}</p>
          </Fold>
        )}

        {counterItems.length > 0 && (
          <Fold title="반대 논거 · 리스크" hint={`${counterItems.length}개`}>
            <ul className="flex flex-col gap-1.5 text-[13px] text-ink-2 leading-relaxed">
              {counterItems.map((t, i) => (
                <li key={`${i}-${t}`}>· {t}</li>
              ))}
            </ul>
          </Fold>
        )}

        {evasion && (
          <Fold title="질문 회피" hint={evasion.evasionScore !== null ? `회피도 ${pct(evasion.evasionScore)}` : undefined}>
            <div className="flex flex-col gap-2 text-[13px] text-ink-2 leading-relaxed">
              <Meter label="회피도" value={evasion.evasionScore} />
              {evasion.missingTopics.length > 0 && (
                <p>답변에서 빠진 주제 · {evasion.missingTopics.join(', ')}</p>
              )}
              {evasion.pivotDetected && <p>답변이 다른 주제로 전환되었습니다.</p>}
              {evasion.rationaleKo && <p className="text-ink-3">{evasion.rationaleKo}</p>}
            </div>
          </Fold>
        )}

        {impactChain.length > 0 && (
          <Fold title="파급 영향" hint={`${impactChain.length}개 종목`}>
            <ul className="flex flex-col gap-1.5">
              {impactChain.map((link, i) => (
                <li key={`${link.ticker}-${i}`} className="flex items-center gap-3 text-[13px]">
                  <button
                    type="button"
                    onClick={() => onOpenTicker(link.ticker)}
                    className="num font-semibold text-ink-1 underline decoration-dotted underline-offset-2 w-14 text-left"
                    aria-label={`${link.ticker} 종목 브리핑 열기`}
                  >
                    {link.ticker}
                  </button>
                  <span className="text-ink-3 w-28 shrink-0 truncate" title={link.relationship ?? undefined}>
                    {link.relationship ? RELATIONSHIP_LABELS[link.relationship] ?? link.relationship : '—'}
                  </span>
                  {/* 점수가 없다는 건 "영향 0" 이 아니라 "잴 근거가 없었다" 는 뜻이다. 그때 엔진의 방향은 이 종목이 아니라
                      콜 문장 전체의 어조에서 나온 값이라, 종목별 방향처럼 보이지 않게 비운다 */}
                  <span className="text-ink-2 w-10 shrink-0">
                    {link.impactScore !== null && link.direction ? IMPACT_LABELS[link.direction] : '—'}
                  </span>
                  {link.impactScore === null ? (
                    <span className="text-ink-3 shrink-0">근거 없음</span>
                  ) : (
                    <span className="tabular-nums text-ink-3">{pct(link.impactScore)}</span>
                  )}
                  {link.rationaleKo && <span className="text-ink-3 truncate" title={link.rationaleKo}>{link.rationaleKo}</span>}
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {riskPlan && (
          <Fold title="손절 · 익절 계획" hint="참고용">
            {/* 계획은 참고 정보다. 주문 입력과 연결하지 않는다 — 자동으로 채우면 확인 없이 따라가기 쉽다. */}
            {riskPlan.available === true ? (
              <div className="flex flex-col gap-2 text-[13px]">
                {riskPlan.direction && (
                  <span className="tabular-nums text-ink-3">
                    {riskPlan.direction}
                    {riskPlan.referencePrice !== null && ` · 기준가 ${money(riskPlan.referencePrice)}`}
                  </span>
                )}
                <dl className="grid grid-cols-3 gap-3">
                  <Plan label="손절" value={money(riskPlan.stopLoss)} sub={signedPct(riskPlan.stopPct)} />
                  <Plan label="1차 익절" value={money(riskPlan.takeProfit1)} sub={signedPct(riskPlan.takeProfit1Pct)} />
                  <Plan label="2차 익절" value={money(riskPlan.takeProfit2)} sub={signedPct(riskPlan.takeProfit2Pct)} />
                </dl>
                <span className="text-ink-3">
                  손익비 {riskPlan.riskReward1 === null ? '—' : `${riskPlan.riskReward1.toFixed(1)}:1`}
                  {riskPlan.timeStopDays !== null && ` · 시간 손절 ${riskPlan.timeStopDays}일`}
                </span>
                {riskPlan.invalidationText && <span className="text-ink-3">무효화 조건 · {riskPlan.invalidationText}</span>}
              </div>
            ) : riskPlan.available === false ? (
              <p className="text-[13px] text-ink-3">{riskPlan.invalidationText ?? '가격 정보가 없어 계획을 산출하지 못했습니다.'}</p>
            ) : (
              <p className="text-[13px] text-ink-3">계획 산출 여부를 확인할 수 없습니다(엔진 응답 형식 확인 필요).</p>
            )}
          </Fold>
        )}
      </div>

      {summary.intelligenceAvailable === false && (
        <p className="text-[12.5px] text-ink-3">회피 지표 · 파급 영향 · 손절 계획을 가져오지 못했습니다. 판단만 표시합니다.</p>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px] text-warning" aria-label="엔진 경고">
          {warnings.map((w, i) => (
            <li key={`${i}-${w}`}>! {w}</li>
          ))}
        </ul>
      )}

      {/* 모델명은 폴백 여부를, 생성 시각은 이번 회차 판단인지를 눈으로 확인하는 용도다. */}
      <div className="flex items-center justify-between gap-2 text-[12px] text-ink-3">
        {judgment.modelVersion ? <span className="num truncate">{judgment.modelVersion}</span> : <span>모델 미상</span>}
        {summary.generatedAt && <span className="num shrink-0">{formatTime(summary.generatedAt)}</span>}
      </div>
    </>
  )
}

function DiffSummary({
  counts,
  previousCallLabel,
}: {
  counts: Record<TranscriptDiffChangeType, number>
  previousCallLabel: string | null
}) {
  const total = CHANGE_ORDER.reduce((n, t) => n + counts[t], 0)
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-5">
      <span className="text-[13px] text-ink-3">
        직전 콜 대조{previousCallLabel ? ` · ${previousCallLabel}` : ''}
      </span>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
        {CHANGE_ORDER.filter((t) => counts[t] > 0).map((t) => (
          <span key={t}>
            <span style={{ color: CHANGE_META[t].color }}>
              {CHANGE_META[t].symbol} {CHANGE_META[t].label}
            </span>{' '}
            <span className="tabular-nums text-ink-2">{counts[t]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="group cloud-s rounded-[18px] px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
        <span className="text-[14px] font-semibold text-ink-1 on-glass">{title}</span>
        <span className="flex items-center gap-2 text-[12px] text-ink-3">
          {hint}
          <span className="transition-transform duration-200 group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  )
}

function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-ink-3 w-12 shrink-0">{label}</span>
      {/* 값이 없으면 0% 막대로 그리지 않는다 — 0 과 미상은 다른 이야기다. */}
      <div
        className="flex-1 h-1 rounded-full bg-wash/[0.08]"
        style={value === null ? { backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-hatch) 0 3px, transparent 3px 6px)' } : undefined}
      >
        {value !== null && <div className="h-full rounded-full bg-ink-2" style={{ width: `${value * 100}%` }} />}
      </div>
      <span className="tabular-nums text-[12px] text-ink-2 w-10 text-right">{pct(value)}</span>
    </div>
  )
}

function Plan({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="tabular-nums text-[16px] font-semibold text-ink-1">{value}</dd>
      <dd className="tabular-nums text-[12px] text-ink-3">{sub}</dd>
    </div>
  )
}

/** ISO-8601 → KST HH:MM:SS. 파싱에 실패하면 원문을 그대로 보여 준다(값을 지어내지 않는다). */
function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${KST_TIME.format(d)} KST`
}

const KST_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
