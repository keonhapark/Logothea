import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { StockDetailResponsePayload } from '../../../lib/types/stockDetail'
import { countdownParts, epsBulletDomain, epsBulletRatio } from '../../lib/callScreen'
import { formatDirectPercent, formatEps, formatRevenue } from '../../lib/companyDetailFormatters'
import ScrollEdge from './ScrollEdge'
import { ComingSoon, EmptyState, LoadingBlock } from '../common/StateView'

interface CallBriefingProps {
  detail: StockDetailResponsePayload | null
  loading: boolean
  error: Error | null
  topInset: number
}

/**
 * 시작 전 브리핑 — 콜이 시작되기 전 콜 화면의 주인공 (docs/design/ux.md 콜 준비).
 *
 * 빈 자막 대신 "이 콜을 듣기 전에 알아야 할 것" 을 위에서부터 둔다. 콜 시작까지 남은 시간, 일정,
 * 시장 기대치, 지난 분기 어닝 반응 순서다. AI 사전 요약은 데이터가 없어 자리만 둔다.
 * 콜이 시작되면(첫 자막 도착) 같은 화면이 자막으로 바뀐다.
 */
export default function CallBriefing({ detail, loading, error, topInset }: CallBriefingProps) {
  const next = detail?.nextEarning ?? null
  // 최근 분기부터. 응답 순서에 기대지 않고 발표 시각으로 정렬한다.
  const history = [...(detail?.earningsHistory ?? [])].sort((a, b) => b.announcedAt - a.announcedAt).slice(0, 4)
  const epsDomain = epsBulletDomain(history.flatMap((row) => [row.epsEstimate, row.epsActual]))

  return (
    <section className="cloud relative h-full rounded-[28px] overflow-hidden" aria-label="시작 전 브리핑">
      <ScrollEdge height={topInset + 12} />
      <div className="absolute inset-0 overflow-y-auto" style={{ paddingTop: topInset }}>
        <div className="px-8 pt-4 pb-10 flex flex-col gap-8 max-w-[760px]">
          {loading && !detail ? (
            <LoadingBlock lines={6} lineHeight={18} />
          ) : error && !detail ? (
            <EmptyState message="종목 정보를 불러오지 못했습니다. 콜이 시작되면 자막은 그대로 들어옵니다." />
          ) : (
            <>
              <Countdown next={next} />

              <div className="grid grid-cols-2 gap-6">
                <Block title="시장 기대치">
                  {next ? (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
                      <dt className="text-ink-3">EPS 컨센서스</dt>
                      <dd className="tabular-nums text-right text-ink-1">{formatEps(next.epsEstimate)}</dd>
                      <dt className="text-ink-3">매출 컨센서스</dt>
                      <dd className="tabular-nums text-right text-ink-1">{formatRevenue(next.revenueEstimate)}</dd>
                    </dl>
                  ) : (
                    <p className="text-[13px] text-ink-3">다음 실적 일정이 잡히면 기대치를 보여 줍니다.</p>
                  )}
                </Block>

                <Block title="최근 어닝 반응">
                  {history.length === 0 ? (
                    <p className="text-[13px] text-ink-3">지난 실적 기록이 없습니다.</p>
                  ) : (
                    <ul className="flex flex-col gap-2 text-[14px]">
                      {history.map((row) => (
                        <li key={`${row.fiscalPeriodLabel}-${row.announcedAt}`} className="flex items-baseline justify-between gap-3">
                          <span className="text-ink-2">{row.fiscalPeriodLabel}</span>
                          <span className="flex items-baseline gap-3">
                            <EpsBullet estimate={row.epsEstimate} actual={row.epsActual} domain={epsDomain} />
                            <Reaction value={row.priceReactionPercent} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>
              </div>

              <ComingSoon title="AI 사전 요약" note="콜 전에 짚어 볼 쟁점을 정리하는 기능은 준비 중입니다" />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Countdown({ next }: { next: StockDetailResponsePayload['nextEarning'] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!next) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-ink-3">다음 콜</span>
        <span className="text-[24px] font-bold text-ink-1">예정된 실적 발표가 없습니다</span>
        <span className="text-[13px] text-ink-3">콜이 시작되면 이 화면이 자막으로 바뀝니다.</span>
      </div>
    )
  }

  const parts = countdownParts(next.scheduledAt, now)
  const hot = parts != null && parts.days === 0 && parts.hours === 0 && parts.minutes === 0 && parts.seconds <= 10
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-ink-3">콜 시작까지</span>
      {parts ? (
        <span
          role="timer"
          aria-live="off"
          className={`flex flex-wrap items-center gap-1.5 ${hot ? 'flip-hot' : ''}`}
        >
          <span className="sr-only">
            {parts.days > 0 && `${parts.days}일 `}
            {parts.hours}시간 {parts.minutes}분 {parts.seconds}초
          </span>
          {parts.days > 0 && (
            <span aria-hidden className="num text-[40px] font-semibold text-ink-1 mr-2">
              {parts.days}
              <span className="font-sans text-[26px] text-ink-2">일</span>
            </span>
          )}
          {[parts.hours, parts.minutes, parts.seconds].map((n, g) => (
            <span key={g} aria-hidden className="flex items-center gap-1.5">
              {g > 0 && <span className="num text-[34px] font-semibold text-ink-3 mx-0.5">:</span>}
              <FlipDigit value={String(n).padStart(2, '0')[0]} />
              <FlipDigit value={String(n).padStart(2, '0')[1]} />
            </span>
          ))}
        </span>
      ) : (
        <span className="text-[24px] font-bold text-ink-1">예정 시각이 지났습니다 · 첫 자막을 기다립니다</span>
      )}
      <span className="text-[14px] text-ink-2">
        {formatKst(next.scheduledAt)} KST
        <span className="text-ink-3"> (미 동부 {formatEt(next.scheduledAt)})</span>
        <span className="text-ink-3"> · {next.confirmed ? '확정' : '예정'}</span>
      </span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] font-semibold text-ink-2">{title}</span>
      {children}
    </div>
  )
}

/**
 * 넘어가는 숫자판 한 자리 — 값이 바뀌면 위 반쪽이 옛 숫자를 들고 접히고, 아래 반쪽이 새 숫자를 들고 펼쳐진다.
 * 접는 반쪽은 React 밖에서 잠깐 붙였다 뗀다. 모션 줄이기를 켰으면 바로 바뀐다. 모양은 global.css `.flip-digit`.
 */
function FlipDigit({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = useRef(value)
  // 아래 반쪽은 펼침이 끝날 때까지 옛 숫자를 들고 있다
  const [bottom, setBottom] = useState(value)

  useLayoutEffect(() => {
    const old = shown.current
    shown.current = value
    const el = ref.current
    if (old === value || !el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || typeof el.animate !== 'function') {
      setBottom(value)
      return
    }
    const flap = (side: 'top' | 'bot', text: string) => {
      const d = document.createElement('div')
      d.className = `half ${side} flap`
      const i = document.createElement('i')
      i.textContent = text
      d.append(i)
      el.append(d)
      return d
    }
    const top = flap('top', old)
    const bot = flap('bot', value)
    bot.style.transform = 'rotateX(90deg)'
    let unfold: Animation | null = null
    const fold = top.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], {
      duration: 220,
      easing: 'ease-in',
      fill: 'forwards',
    })
    fold.onfinish = () => {
      unfold = bot.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], {
        duration: 220,
        easing: 'ease-out',
        fill: 'forwards',
      })
      unfold.onfinish = () => {
        // 반쪽을 떼기 전에 아래 반쪽을 새 숫자로 그려 둔다. 미루면 옛 숫자가 한 프레임 비친다.
        flushSync(() => setBottom(value))
        top.remove()
        bot.remove()
      }
    }
    return () => {
      fold.cancel()
      unfold?.cancel()
      top.remove()
      bot.remove()
      setBottom(value)
    }
  }, [value])

  return (
    <div ref={ref} className="flip-digit">
      <div className="half top">
        <i>{value}</i>
      </div>
      <div className="half bot">
        <i>{bottom}</i>
      </div>
    </div>
  )
}

/**
 * EPS 예상 대비 실제 — 막대는 실제, 세로 금은 예상이다. 넘었으면 ok, 못 미쳤으면 danger 색.
 * 줄마다 같은 눈금(domain)을 써서 분기끼리 견줄 수 있다. 둘 중 하나라도 없으면 글로 보여 준다.
 */
function EpsBullet({
  estimate,
  actual,
  domain,
}: {
  estimate: number | null
  actual: number | null
  domain: readonly [number, number] | null
}) {
  const label = `EPS 예상 ${formatEps(estimate)} · 실제 ${formatEps(actual)}`
  if (estimate == null || actual == null || !Number.isFinite(estimate) || !Number.isFinite(actual) || domain == null) {
    return (
      <span className="tabular-nums text-[12px] text-ink-3">
        EPS {formatEps(estimate)} → {formatEps(actual)}
      </span>
    )
  }
  const W = 100
  const beat = actual >= estimate
  const fill = epsBulletRatio(actual, domain) * W
  const tick = epsBulletRatio(estimate, domain) * W
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={label} title={label}>
      <svg width={W} height={12} viewBox={`0 0 ${W} 12`} className="overflow-visible" aria-hidden="true">
        <rect x={0} y={4} width={W} height={4} rx={2} fill="rgb(var(--ink-rgb) / 0.12)" />
        <rect x={0} y={3} width={fill} height={6} rx={3} fill={beat ? 'var(--ok)' : 'var(--danger)'} />
        <rect x={Math.min(W - 2, Math.max(0, tick - 1))} y={-1} width={2} height={14} fill="var(--ink-1)" />
      </svg>
      <span className="tabular-nums text-[12px] text-ink-2">{formatEps(actual)}</span>
    </span>
  )
}

function Reaction({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="tabular-nums text-ink-3 w-16 text-right">—</span>
  const up = value >= 0
  return (
    <span className="tabular-nums font-semibold w-16 text-right" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
      {up ? '▲' : '▼'} {formatDirectPercent(Math.abs(value))}
    </span>
  )
}

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

const ET = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
})

function formatKst(sec: number): string {
  return KST.format(new Date(sec * 1000))
}

function formatEt(sec: number): string {
  return ET.format(new Date(sec * 1000))
}
