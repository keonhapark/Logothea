import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EarningsSummary, ImpactDirection, SignalDirection } from '@terminal/renderer/types/earningsSummary'
import type { TranscriptDiffChangeType } from '@terminal/renderer/store/useTranscriptDiffStore'
import type { PricePoint } from '@terminal/renderer/types/priceSeries'
import { countDiffsByType } from '@terminal/renderer/lib/callScreen'
import { catalystLabel } from '@terminal/renderer/lib/catalystLabel'
import { useCompanyDetail } from '@terminal/renderer/hooks/useCompanyDetail'
import { CHANGE_META, CHANGE_ORDER } from '@terminal/renderer/components/call/diffMeta'
import RiskBands from './RiskBands'
import { openBrief } from '../Brief'
import type { CallData } from './useCallData'

/**
 * 판단. 데스크톱 CallVerdict(components/call/CallVerdict.tsx)의 순서를 한 열로 쌓았다:
 * 실행 판단 → 방향 · 촉매 → 강도 · 신뢰도 막대 → 펼쳐 보기들 → 누락 · 경고 → 대조 집계.
 * - 콜 진행 중: "콜이 끝나면 종합 판단이 나옵니다" + 지금까지 대조 집계. 지난 회차 판단이 있으면 접어서 둔다.
 * - 종료 후 판단 대기: 데스크톱의 흐르는 막대 · 단계 안내 그대로(3분이 지나면 받지 못했다는 안내).
 * - 다음 회차 남은 시간 줄은 백엔드 반복 방송이 생기면 붙인다.
 */
export default function VerdictTab({ data }: { data: CallData }) {
  const counts = useMemo(() => countDiffsByType(data.diffItems), [data.diffItems])
  const { data: detail } = useCompanyDetail(data.summary || data.previousSummary ? data.ticker : null)
  const priceSeries = useMemo<readonly PricePoint[]>(
    () => (detail?.chart30d ?? []).filter((d) => Number.isFinite(d.close)).map((d) => ({ time: d.date.slice(5), price: d.close })),
    [detail],
  )
  const previousLabel = data.previousCall?.fiscalQuarter ? `${data.previousCall.fiscalQuarter} 콜과 비교` : null

  return (
    <div className="stack-10">
      <section className="verdict cloud" aria-label="종합 판단">
        {data.summary ? (
          <Verdict summary={data.summary} priceSeries={priceSeries} />
        ) : data.phase === 'ENDED' ? (
          <Waiting waitKey={data.callId} />
        ) : (
          <div className="flex flex-col gap-1.5" role="status">
            <span className="vk">종합 판단</span>
            <span className="text-[19px] font-bold text-ink-1 leading-snug">콜이 끝나면 종합 판단이 나옵니다</span>
            <span className="text-[13px] text-ink-3">콜 전체를 다시 읽고 직전 콜과 대조한 뒤 판단을 만듭니다. 그동안은 아래 대조 집계를 참고하세요.</span>
          </div>
        )}
        <DiffSummary counts={counts} label={previousLabel} />
      </section>
      {data.previousSummary && (
        <details className="fold cloud-s">
          <summary>
            <span>지난 회차 판단</span>
            <span className="fold-hint">펼치기</span>
          </summary>
          <div className="flex flex-col gap-4 pt-3">
            <Verdict summary={data.previousSummary} priceSeries={priceSeries} />
          </div>
        </details>
      )}
    </div>
  )
}

// ── 대기 ─────────────────────────────────────────────────────────────────

/** 기다리기 시작한 시각을 회차별로 기억한다. 탭을 오가도 이어 센다. */
const waitStarts = new Map<string, number>()
export const SUMMARY_WAIT_LIMIT_MS = 3 * 60 * 1000
const WAIT_STEPS: { label: string; untilSec: number }[] = [
  { label: '전문 다시 읽기', untilSec: 12 },
  { label: '직전 콜과 대조', untilSec: 30 },
  { label: '판단 만들기', untilSec: Infinity },
]

export function waitStartFor(key: string | null, now = Date.now()): number {
  if (!key) return now
  let started = waitStarts.get(key)
  if (started === undefined) {
    started = now
    waitStarts.set(key, started)
  }
  return started
}

/** 지난 시간(초) → 지금 단계. 서버가 알려 주는 것이 아니라 시간으로 넘기는 안내다. */
export function waitStepIndex(elapsedSec: number): number {
  return WAIT_STEPS.findIndex((s) => elapsedSec < s.untilSec)
}

function Waiting({ waitKey }: { waitKey: string | null }) {
  const [startedAt] = useState(() => waitStartFor(waitKey))
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000))
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const timedOut = elapsed * 1000 >= SUMMARY_WAIT_LIMIT_MS
  const current = waitStepIndex(elapsed)

  return (
    <div className="flex flex-col gap-2" role="status">
      <span className="vk">종합 판단</span>
      {timedOut ? (
        <>
          <span className="text-[19px] font-bold text-ink-1">종합 판단을 받지 못했습니다</span>
          <span className="text-[13px] text-ink-3 leading-relaxed">콜이 끝나고 3분이 지나도 판단이 오지 않았습니다. 판단은 회차마다 한 번만 옵니다.</span>
        </>
      ) : (
        <>
          <span className="text-[19px] font-bold text-ink-1">콜 전체를 종합하는 중입니다</span>
          <span className="text-[13px] text-ink-3 tabular-nums">
            <span aria-hidden>{elapsed}초 지남 · </span>전문을 다시 읽고 판단을 만듭니다
          </span>
          <div className="wait-bar" aria-hidden>
            <i />
            <i />
          </div>
          <ol className="flex flex-col gap-2 text-[14px] pt-1">
            {WAIT_STEPS.map((s, i) => {
              const done = i < current
              const on = i === current
              return (
                <li key={s.label} className={`flex items-center gap-2.5 ${done ? 'text-ink-2' : on ? 'text-ink-1' : 'text-ink-3'}`}>
                  <span className="w-4 h-4 rounded-full grid place-items-center shadow-[inset_0_0_0_1.5px_currentColor]" aria-hidden>
                    {done && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5.2l2 2L8 3" />
                      </svg>
                    )}
                  </span>
                  {s.label}
                  <span className="sr-only">{done ? ' · 끝남' : on ? ' · 진행 중' : ''}</span>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}

// ── 판단 ─────────────────────────────────────────────────────────────────

const DIRECTION_LABELS: Record<SignalDirection, string> = { BULLISH: '강세', BEARISH: '약세', NEUTRAL: '중립' }
const ACTION_LABELS: Record<string, string> = { AVOID: '실행 보류', HOLD: '관망', BUY: '진입 가능', SELL: '청산 우선', WATCH: '관찰' }
const GATE_META: Record<string, { label: string; color: string }> = {
  pass: { label: '통과', color: 'var(--olive-ink)' },
  soft_block: { label: '조건부 보류', color: 'var(--ink-2)' },
  hard_block: { label: '차단', color: 'var(--porphyra-ink)' },
}
const IMPACT_LABELS: Record<ImpactDirection, string> = { positive: '수혜', negative: '부정', mixed: '혼재', neutral: '중립' }

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const money = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`)
const signedPct = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`)
const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const formatTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : KST.format(d)
}

function Verdict({ summary, priceSeries }: { summary: EarningsSummary; priceSeries: readonly PricePoint[] }) {
  const { judgment, gate, evasion, impactChain, riskPlan, warnings } = summary
  const action = gate?.action ? ACTION_LABELS[gate.action] ?? gate.action : null
  const gateMeta = gate?.gateResult ? GATE_META[gate.gateResult] ?? { label: gate.gateResult, color: 'var(--ink-2)' } : null
  const catalyst = judgment.catalystType ? catalystLabel(judgment.catalystType) : null
  const counterItems = [...(gate?.counterThesisKo ? [gate.counterThesisKo] : []), ...(gate?.riskFlagsKo ?? [])]

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="vk">실행 판단</span>
        {action ? (
          <span className="vbig">
            {action}
            {gateMeta && (
              <span className="text-[16px] font-semibold" style={{ color: gateMeta.color }}>
                {' '}
                · {gateMeta.label}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[16px] font-semibold text-ink-2">실행 판단이 오지 않았습니다 · 방향만 참고하세요</span>
        )}
        {gate?.positionIntentKo && <p className="text-[14px] text-ink-1 leading-relaxed">{gate.positionIntentKo}</p>}
        {gate?.noTradeSummaryKo && <p className="text-[13px] text-ink-2 leading-relaxed">보류 사유 · {gate.noTradeSummaryKo}</p>}
      </div>

      <div className="flex items-start justify-between gap-4 border-t border-[var(--line)] pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="vk">방향</span>
          <span className="text-[17px] font-semibold text-ink-1">{DIRECTION_LABELS[judgment.direction]}</span>
          {catalyst && <span className="text-[12.5px] text-ink-3">촉매 · {catalyst}</span>}
        </div>
        {gate?.institutionalGrade && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="vk">기관 등급</span>
            <span className="tabular-nums text-[17px] font-semibold text-ink-1">
              {gate.institutionalGrade}
              {gate.institutionalGradeScore !== null && <span className="text-[12.5px] text-ink-3 font-normal"> · {Math.round(gate.institutionalGradeScore)}</span>}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Meter label="강도" value={judgment.magnitude} />
        <Meter label="신뢰도" value={judgment.confidence} />
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
              {evasion.missingTopics.length > 0 && <p>답변에서 빠진 주제 · {evasion.missingTopics.join(', ')}</p>}
              {evasion.pivotDetected && <p>답변이 다른 주제로 전환되었습니다.</p>}
              {evasion.rationaleKo && <p className="text-ink-3">{evasion.rationaleKo}</p>}
            </div>
          </Fold>
        )}
        {impactChain.length > 0 && (
          <Fold title="파급 영향" hint={`${impactChain.length}개 종목`}>
            <ul className="flex flex-col">
              {impactChain.map((link, i) => (
                <li key={`${link.ticker}-${i}`} className="border-t border-[var(--line)] first:border-t-0">
                  <button type="button" className="row-btn impact" onClick={() => openBrief(link.ticker)} aria-label={`${link.ticker} 종목 브리핑 열기`}>
                    <b className="tnum">{link.ticker}</b>
                    <span className="text-ink-3 truncate">{link.relationship ?? '—'}</span>
                    <span className="text-ink-2 shrink-0">
                      {link.impactScore !== null && link.direction ? `${IMPACT_LABELS[link.direction]} ${pct(link.impactScore)}` : '근거 없음'}
                    </span>
                  </button>
                  {link.rationaleKo && <p className="text-[12.5px] text-ink-3 pb-2">{link.rationaleKo}</p>}
                </li>
              ))}
            </ul>
          </Fold>
        )}
        {riskPlan && (
          <Fold title="손절 · 익절 계획" hint="참고용">
            {riskPlan.available === true ? (
              <div className="flex flex-col gap-2 text-[13px]">
                {riskPlan.direction && (
                  <span className="tabular-nums text-ink-3">
                    {riskPlan.direction}
                    {riskPlan.referencePrice !== null && ` · 기준가 ${money(riskPlan.referencePrice)}`}
                  </span>
                )}
                <RiskBands
                  series={priceSeries}
                  referencePrice={riskPlan.referencePrice}
                  stopLoss={riskPlan.stopLoss}
                  takeProfit1={riskPlan.takeProfit1}
                  takeProfit2={riskPlan.takeProfit2}
                  stopPct={riskPlan.stopPct}
                  takeProfit1Pct={riskPlan.takeProfit1Pct}
                  takeProfit2Pct={riskPlan.takeProfit2Pct}
                  days={riskPlan.timeStopDays}
                />
                <dl className="grid grid-cols-3 gap-2">
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
              <p className="text-[13px] text-ink-3">계획 산출 여부를 확인할 수 없습니다.</p>
            )}
          </Fold>
        )}
      </div>

      {summary.intelligenceAvailable === false && <p className="text-[12.5px] text-ink-3">회피 지표 · 파급 영향 · 손절 계획을 가져오지 못했습니다. 판단만 표시합니다.</p>}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]" style={{ color: 'var(--caution)' }} aria-label="엔진 경고">
          {warnings.map((w, i) => (
            <li key={`${i}-${w}`}>! {w}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 text-[12px] text-ink-3">
        {judgment.modelVersion ? <span className="num truncate">{judgment.modelVersion}</span> : <span>모델 미상</span>}
        {summary.generatedAt && <span className="shrink-0">{formatTime(summary.generatedAt)}</span>}
      </div>
    </>
  )
}

function DiffSummary({ counts, label }: { counts: Record<TranscriptDiffChangeType, number>; label: string | null }) {
  const total = CHANGE_ORDER.reduce((n, t) => n + counts[t], 0)
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--line)] pt-3">
      <span className="vk">직전 콜 대조{label ? ` · ${label}` : ''}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
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
    <details className="fold cloud-s">
      <summary>
        <span>{title}</span>
        <span className="fold-hint">
          {hint}
          <span className="fold-arrow" aria-hidden="true">
            ▾
          </span>
        </span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  )
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value === null ? null : Math.max(0, Math.min(1, value))
  return (
    <div className="meter">
      <span>{label}</span>
      <span className="meter-track dent" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={v ?? undefined}>
        {v !== null && <i style={{ width: `${v * 100}%` }} />}
      </span>
      <span className="tnum">{v === null ? '—' : v.toFixed(2)}</span>
    </div>
  )
}

function Plan({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="cloud-s rounded-[12px] px-2.5 py-2 flex flex-col">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="m-0 tabular-nums text-[14px] text-ink-1">{value}</dd>
      <dd className="m-0 tabular-nums text-[11.5px] text-ink-3">{sub}</dd>
    </div>
  )
}
