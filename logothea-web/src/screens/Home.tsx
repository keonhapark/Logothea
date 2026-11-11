import { useEffect, useMemo, useState } from 'react'
import { useEarningsTimeline } from '@terminal/renderer/hooks/useEarningsTimeline'
import { useMarketIndices } from '@terminal/renderer/hooks/useMarketIndices'
import { useStockMarketStore } from '@terminal/renderer/store/useStockMarketStore'
import { useTranscriptDiffStore } from '@terminal/renderer/store/useTranscriptDiffStore'
import { useTranscriptTranslationStore } from '@terminal/renderer/store/useTranscriptTranslationStore'
import { useEarningsSummaryStore } from '@terminal/renderer/store/useEarningsSummaryStore'
import type { MarketIndexItem } from '@terminal/renderer/store/useMarketIndicesStore'
import type { EarningsEvent, EarningsTimelineData } from '@terminal/lib/types/earningsTimeline'
import type { EarningsSummary } from '@terminal/renderer/types/earningsSummary'
import { navigate } from '../app/router'
import { BROADCAST_TICKER, useBroadcastView, type BroadcastView } from '../app/broadcast'
import { openBrief } from './Brief'
import ServerNotice from '../components/ServerNotice'
import { isGuestBlocked, useGuestStatus } from '../app/guestStatus'
import { elapsedLabel, kstClock, kstShortDateTime, priceDirClass, signedPercent } from '../lib/format'

/**
 * 홈. 진행 중인 콜 카드 → 주요 지수 → 다가오는 실적 발표. 계좌 · 내 종목 판은 없다.
 * 데스크톱 HomePage(pages/HomePage.tsx)의 상태 문구를 그대로 쓴다.
 */
export default function Home() {
  return (
    <main className="screen">
      <h1 className="large-title" tabIndex={-1}>홈</h1>
      <ServerNotice />
      <LiveCallCard />
      <Indices />
      <Schedule />
    </main>
  )
}

// ── 진행 중인 콜 ───────────────────────────────────────────────────────────

function LiveCallCard() {
  const view = useBroadcastView()
  const list = useStockMarketStore((s) => s.list)
  const loadList = useStockMarketStore((s) => s.loadList)
  useEffect(() => {
    void loadList()
  }, [loadList])
  const companyName = list.find((s) => s.ticker === BROADCAST_TICKER)?.companyName ?? null

  if (view.kind === 'live') return <OnAirCard view={view} companyName={companyName} />
  if (view.kind === 'between') return <BetweenCard view={view} companyName={companyName} />
  // 방송을 모르거나 재생한 적이 없으면 카드를 두지 않는다
  return null
}

function callTitle(companyName: string | null) {
  return `${companyName ? `${companyName} ` : ''}${BROADCAST_TICKER} · 실적 발표 콜`
}

function OnAirCard({ view, companyName }: { view: Extract<BroadcastView, { kind: 'live' }>; companyName: string | null }) {
  const previousCall = useTranscriptDiffStore((s) => s.byTicker.get(BROADCAST_TICKER)?.previousCall ?? null)
  const translations = useTranscriptTranslationStore((s) => s.byTicker.get(BROADCAST_TICKER)?.items)
  const segments = view.segments
  const last = segments[segments.length - 1]

  // 최근 자막 한 줄: 이번 회차의 마지막 번역이 있으면 번역, 없으면 원문
  const latest = useMemo(() => {
    if (!last) return null
    const ownTranslations = (translations ?? []).filter((t) => t.callId === last.callId)
    const lastTranslation = ownTranslations[ownTranslations.length - 1]
    if (lastTranslation) {
      const firstSeq = lastTranslation.sequences[0]
      const speaker = segments.find((s) => s.sequence === firstSeq)?.speaker
      return { speaker, text: lastTranslation.textKo }
    }
    return { speaker: last.speaker, text: last.text }
  }, [last, segments, translations])

  return (
    <section className="hero cloud" aria-labelledby="hero-title">
      <span className="live">
        <i aria-hidden="true" />
        LIVE · 지금 방송 중
      </span>
      <h2 id="hero-title">{callTitle(companyName)}</h2>
      <span className="hero-meta">
        {last ? elapsedLabel(last.endMs) : '방금 시작'}
        {previousCall?.fiscalQuarter ? ` · ${previousCall.fiscalQuarter} 콜과 비교 중` : ''}
      </span>
      {latest && (
        <p className="hero-snip">
          {latest.speaker && <b>{latest.speaker} </b>}
          {latest.text}
        </p>
      )}
      <button type="button" className="cta tint hero-cta" onClick={() => navigate('/call')}>
        콜 보기
      </button>
    </section>
  )
}

/**
 * 방송이 쉬는 중. 반복 방송이면 다음 회차를 기다리는 중이고, 아니면 방송을 마쳤다.
 * 지난 회차 판단은 중간 입장 스냅샷이나 실시간으로 받은 것이며, 상태 API 의 마지막 회차와 같을 때만 보인다.
 */
export function betweenVerdict(summary: EarningsSummary | null, lastCallId: string | null): string | null {
  if (!summary) return null
  // 어느 쪽이든 회차를 모르면 같은 회차로 본다(데스크톱 deriveCallPhase 와 같은 규칙)
  const sameRound = summary.callId === null || lastCallId === null || summary.callId === lastCallId
  return sameRound ? (summary.gate?.positionIntentKo ?? summary.gate?.noTradeSummaryKo ?? null) : null
}

function BetweenCard({ view, companyName }: { view: Extract<BroadcastView, { kind: 'between' }>; companyName: string | null }) {
  const summary = useEarningsSummaryStore((s) => s.byTicker.get(BROADCAST_TICKER) ?? null)
  const verdict = betweenVerdict(summary, view.lastCallId)
  return (
    <section className="hero cloud" aria-labelledby="hero-title">
      <span className="live" style={{ color: 'var(--ink-3)' }}>
        {view.loop ? '회차 사이' : '방송 종료'}
      </span>
      <h2 id="hero-title">{callTitle(companyName)}</h2>
      <span className="hero-meta">{view.loop ? '다음 회차를 준비하고 있습니다' : '방송을 마쳤습니다'}</span>
      {verdict && <p className="hero-snip">지난 회차 판단 · {verdict}</p>}
    </section>
  )
}

// ── 주요 지수 ─────────────────────────────────────────────────────────────

/**
 * 세 칸. 명세는 S&P 500 · 나스닥 · 다우인데 백엔드 지수는 SPX · NDX · VIX · DXY · 10Y 라 다우가 없다.
 * 다우 자리에 VIX 를 둔다.
 */
const INDEX_SLOTS: { symbol: string; label: string }[] = [
  { symbol: 'SPX', label: 'S&P 500' },
  { symbol: 'NDX', label: '나스닥 100' },
  { symbol: 'VIX', label: 'VIX 변동성' },
]

function Indices() {
  const { indices, isLoaded } = useMarketIndices()
  const bySymbol = new Map(indices.map((it) => [it.symbol, it]))
  if (!isLoaded || indices.length === 0) {
    return (
      <section className="cloud-s idx-empty" aria-label="주요 지수">
        시장 지수를 아직 받지 못했습니다.
      </section>
    )
  }
  return (
    <section aria-label="주요 지수">
      <ul className="idx">
        {INDEX_SLOTS.map((slot) => (
          <IndexCell key={slot.symbol} label={slot.label} item={bySymbol.get(slot.symbol)} />
        ))}
      </ul>
    </section>
  )
}

function IndexCell({ label, item }: { label: string; item: MarketIndexItem | undefined }) {
  const price = item
    ? item.format === 'percent'
      ? `${item.price.toFixed(2)}%`
      : item.price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—'
  return (
    <li className="cloud-s">
      <span>{label}</span>
      <b className="tnum">{price}</b>
      {item ? (
        <span className={`tnum ${priceDirClass(item.changePercent)}`}>
          {signedPercent(item.changePercent, 2, item.format === 'percent' ? '%p' : '%')}
        </span>
      ) : (
        <span>정보 없음</span>
      )}
    </li>
  )
}

// ── 다가오는 실적 발표 ─────────────────────────────────────────────────────

const PAGE = 10

/** live 로 빠진 콜도 목록에 둔다(홈 카드는 시연 방송만 다루므로). 그룹 순서는 일정 그대로. */
export function scheduleRows(data: EarningsTimelineData): { kind: string; label: string; events: EarningsEvent[] }[] {
  const groups = data.groups.map((g) => ({ kind: g.kind as string, label: g.label, events: [...g.events] }))
  if (data.live) {
    const today = groups.find((g) => g.kind === 'today')
    if (today) today.events.unshift(data.live)
    else groups.unshift({ kind: 'today', label: '오늘', events: [data.live] })
  }
  return groups
}

/** 앞에서부터 limit 행만 남긴다. 묶음 제목은 그 묶음의 행이 하나라도 남을 때만 둔다. */
export function limitRows<G extends { events: readonly unknown[] }>(groups: readonly G[], limit: number): G[] {
  const out: G[] = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    const events = g.events.slice(0, left)
    left -= events.length
    if (events.length > 0) out.push({ ...g, events })
  }
  return out
}

function Schedule() {
  const { data, status, retry } = useEarningsTimeline()
  // 토큰을 받지 못한 동안 일정 조회는 빈 일정으로 끝난다. 그때 "예정된 콜이 없습니다" 라고 쓰면 일정이 없는 것처럼 읽힌다
  const blocked = isGuestBlocked(useGuestStatus())
  const [limit, setLimit] = useState(PAGE)
  const groups = useMemo(() => scheduleRows(data), [data])
  const total = groups.reduce((n, g) => n + g.events.length, 0)
  const shown = limitRows(groups, limit)

  return (
    <section className="sched cloud" aria-labelledby="sched-title">
      <h2 id="sched-title" className="sched-title">
        다가오는 실적 발표<span>한국 시간</span>
      </h2>
      {status === 'loading' && total === 0 ? (
        <div className="sched-skel" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : status === 'error' && total === 0 ? (
        <div className="state">
          <p>실적 콜 일정을 불러오지 못했습니다.</p>
          <button type="button" className="glass pill" onClick={retry}>
            다시 시도
          </button>
        </div>
      ) : total === 0 ? (
        <p className="state">{blocked ? '서버에 연결되면 일정을 보여 줍니다.' : '예정된 실적 콜이 없습니다.'}</p>
      ) : (
        <>
          {shown.map((g) => {
            const timeOnly = g.kind === 'today' || g.kind === 'tomorrow'
            return (
              <div key={g.kind}>
                <h3 className="sched-g">
                  {g.label} <span className="tnum">{groups.find((x) => x.kind === g.kind)?.events.length}</span>
                </h3>
                <ul className="rows">
                  {g.events.map((e) => (
                    <li key={`${e.ticker}-${e.scheduledAt}`}>
                      <button type="button" className={`row-btn sched-r${timeOnly ? '' : ' sched-r-date'}`} onClick={() => openBrief(e.ticker)}>
                        <span className="num sched-tm">{timeOnly ? kstClock(e.scheduledAt) : kstShortDateTime(e.scheduledAt)}</span>
                        <b className="tnum">{e.ticker}</b>
                        <span className="sched-nm">{e.name}</span>
                        <span className="sr-only">종목 브리핑 열기</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {limit < total && (
            <button type="button" className="glass pill more" onClick={() => setLimit((n) => n + PAGE)}>
              더 보기 <span className="tnum">{total - limit}</span>
            </button>
          )}
        </>
      )}
    </section>
  )
}
