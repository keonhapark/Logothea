import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ipc, IPC_CHANNELS } from '../lib/ipc'
import { usePortfolioStore } from '../store/usePortfolioStore'
import { useUserStore } from '../store/useUserStore'
import { useDrawerStore } from '../store/useDrawerStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useStockMarketStore } from '../store/useStockMarketStore'
import { useMarketIndices } from '../hooks/useMarketIndices'
import { useWatchlist } from '../hooks/useWatchlist'
import { usePrices } from '../hooks/usePrices'
import { useEarningsTimeline } from '../hooks/useEarningsTimeline'
import { ACCOUNT_LABELS, useOrderAccount } from '../hooks/useOrderAccount'
import { showIpcErrorToast } from '../components/common/Toast'
import { EmptyState, LoadingBlock } from '../components/common/StateView'
import Pagination from '../components/common/Pagination'
import SegmentedControl from '../components/common/SegmentedControl'
import ScheduleCalendar from '../components/dashboard/ScheduleCalendar'
import { paginateSchedule, type SchedulePageGroup } from '../lib/homeSchedule'
import { isIpcError } from '../../lib/types/ipcError'
import type {
  EarningsEvent,
  EarningsGroup,
  EarningsLiveEvent,
} from '../../lib/types/earningsTimeline'
import type { MarketIndexItem } from '../store/useMarketIndicesStore'

type MineTag = '보유' | '관심'

/**
 * 홈 — 어닝콜 중심 첫 화면 (docs/design/screens/home.md).
 *
 * 주인공은 진행 중인 콜과 내 종목(관심 + 보유)의 다가오는 콜이다. 전체 일정이 뒤따르고,
 * 시장 지수와 계좌 요약은 오른쪽 좁은 열에 둔다. 기본 창(1200×800)에서 달력까지 스크롤 없이 보이게 잡는다.
 *
 * 잔고 동기화(KIS_GET_BALANCE → 보유 종목 시세 폴링 등록)는 앱 첫 화면인 이 화면이 맡는다.
 */
export default function HomePage() {
  const navigate = useNavigate()
  const openDrawer = useDrawerStore((s) => s.open)

  const { syncBalance } = useBalanceSync()
  const { prices } = usePrices()
  const { items: watchlist } = useWatchlist()
  const holdings = usePortfolioStore((s) => s.holdings)
  const { data: timeline, status: timelineStatus, retry: retryTimeline } = useEarningsTimeline()

  const loadStockList = useStockMarketStore((s) => s.loadList)
  useEffect(() => {
    void loadStockList()
  }, [loadStockList])

  // 관심과 보유가 겹치면 보유로 표시한다 — 내 돈이 걸린 쪽이 더 중요한 정보다.
  const mineTags = useMemo(() => {
    const map = new Map<string, MineTag>()
    for (const w of watchlist) map.set(w.ticker, '관심')
    for (const h of holdings) map.set(h.ticker, '보유')
    return map
  }, [watchlist, holdings])

  const myUpcoming = useMemo(() => {
    const events = timeline.groups.flatMap((g) => g.events).filter((e) => mineTags.has(e.ticker))
    return [...events].sort((a, b) => a.scheduledAt - b.scheduledAt)
  }, [timeline, mineTags])

  const openCall = (ticker: string) => navigate(`/call?ticker=${encodeURIComponent(ticker)}`)
  const [scheduleView, setScheduleView] = useState<'calendar' | 'list'>('calendar')
  return (
    <div className="flex flex-col gap-3 max-w-[1320px] min-h-full">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink-1">홈</h1>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5 items-start flex-1">
        <div className="flex flex-col gap-3 min-w-0 self-stretch">
          {timeline.live && (
            <LiveCallCard
              event={timeline.live}
              tag={mineTags.get(timeline.live.ticker)}
              onOpen={() => openCall(timeline.live!.ticker)}
            />
          )}

          <Panel title="내 종목의 다가오는 콜" meta="관심 · 보유 종목">
            {timelineStatus === 'loading' ? (
              <LoadingBlock lines={3} lineHeight={20} className="px-5 pb-5" />
            ) : timelineStatus === 'error' ? (
              <TimelineError onRetry={retryTimeline} />
            ) : mineTags.size === 0 ? (
              <EmptyState
                message="관심 종목이나 보유 종목이 없습니다. 종목 브리핑에서 관심 종목을 더하면 여기에 콜 일정이 모입니다."
                action={
                  <button type="button" className="gbtn gbtn-sm" onClick={() => navigate('/stocks')}>
                    종목 찾기
                  </button>
                }
              />
            ) : myUpcoming.length === 0 ? (
              <EmptyState message="내 종목 중 다가오는 실적 콜이 없습니다. 일정이 잡히면 여기에 나타납니다." />
            ) : (
              <MyUpcomingPager events={myUpcoming} tags={mineTags} onPick={openDrawer} />
            )}
          </Panel>

          <Panel
            title="전체 일정"
            meta="KST"
            grow
            action={
              <SegmentedControl
                items={[
                  { id: 'calendar', label: '달력' },
                  { id: 'list', label: '목록' },
                ]}
                activeId={scheduleView}
                onChange={setScheduleView}
              />
            }
          >
            {timelineStatus === 'loading' ? (
              <LoadingBlock lines={5} lineHeight={20} className="px-5 pb-5" />
            ) : timelineStatus === 'error' ? (
              <TimelineError onRetry={retryTimeline} />
            ) : timeline.groups.every((g) => g.events.length === 0) ? (
              <EmptyState message="예정된 실적 콜이 없습니다." />
            ) : scheduleView === 'calendar' ? (
              <ScheduleCalendar groups={timeline.groups} tags={mineTags} onPick={openDrawer} />
            ) : (
              <SchedulePager groups={timeline.groups} tags={mineTags} onPick={openDrawer} />
            )}
          </Panel>
        </div>

        <aside className="flex flex-col gap-6">
          <AccountSummary prices={prices} onRetry={syncBalance} onMore={() => navigate('/portfolio')} />
          <MarketIndices />
        </aside>
      </div>
    </div>
  )
}

// ── 데이터 ────────────────────────────────────────────────────────────

/**
 * 잔고 동기화. 마운트 시 한 번 KIS_GET_BALANCE 를 부르고, 보유 종목을 main 시세 폴링에 등록한다.
 * 실패하면 store 에 실패를 남겨 마지막 값 위에 실패를 표시하고, 인증 만료면 다시 로그인으로 보낸다.
 */
function useBalanceSync() {
  const navigate = useNavigate()
  const clearUser = useUserStore((s) => s.clear)
  const setAuthenticated = useConnectionStore((s) => s.setAuthenticated)

  async function syncBalance() {
    const store = usePortfolioStore.getState()
    store.startSync()
    try {
      const balance = await ipc.invoke<{
        orderableCash: number
        totalCash: number
        holdings: any[]
      }>(IPC_CHANNELS.KIS_GET_BALANCE)
      store.setBalance(balance.orderableCash, balance.totalCash, balance.holdings)

      // 빈 배열도 보내서 보유가 0개로 줄어든 경우에도 폴링 대상에서 빠지게 한다.
      const tickers = (balance.holdings ?? []).map((h: any) => h.ticker)
      try {
        await ipc.invoke(IPC_CHANNELS.HOLDINGS_TICKERS_UPDATE, { tickers })
      } catch (e) {
        console.error('[HomePage] HOLDINGS_TICKERS_UPDATE 실패:', e)
        showIpcErrorToast(e)
      }
    } catch (e: unknown) {
      console.error('잔고 조회 실패:', e)
      store.setError('잔고 조회에 실패했습니다.')
      store.setBalanceFetchError(e)
      showIpcErrorToast(e, {
        onNavigate:
          isIpcError(e) && e.code === 'AUTH_EXPIRED'
            ? () => {
                setAuthenticated(false)
                clearUser()
                navigate('/auth')
              }
            : undefined,
      })
    } finally {
      usePortfolioStore.getState().setSyncing(false)
    }
  }

  useEffect(() => {
    void syncBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { syncBalance }
}

// ── 콜 ────────────────────────────────────────────────────────────────

/**
 * 진행 중인 콜. 서버가 예정 시각 창으로 추정한 것이라 실제로 시작했는지는 콜 화면의 자막으로 확인한다.
 * LIVE 는 무채색이다 — 빨강은 가격 상승에만 쓴다.
 */
function LiveCallCard({
  event,
  tag,
  onOpen,
}: {
  event: EarningsLiveEvent
  tag: MineTag | undefined
  onOpen: () => void
}) {
  return (
    <section
      className="cloud rounded-[28px] px-6 py-3.5 flex items-center gap-6"
      aria-label="진행 중인 콜"
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <span className="w-1.5 h-1.5 rounded-full bg-ink-1 animate-pulse" aria-hidden />
          <span className="font-semibold tracking-[0.08em]">LIVE</span>
          <span className="text-ink-3">· 예정 시각 기준으로 진행 중인 것으로 보입니다</span>
        </div>
        <div className="flex items-baseline gap-3 min-w-0 on-glass">
          <span className="num text-[22px] font-semibold text-ink-1">{event.ticker}</span>
          <span className="text-[16px] text-ink-2 truncate">{event.name}</span>
          {tag && <Tag tag={tag} />}
        </div>
        <span className="text-[12.5px] text-ink-3">
          {event.callLabel} · 시작 {formatClock(event.scheduledAt)} KST · 경과{' '}
          <span className="num">{event.elapsed}</span>
        </span>
      </div>
      <button type="button" onClick={onOpen} className="gbtn gbtn-lapis">
        콜 화면 열기
      </button>
    </section>
  )
}

/** 내 종목의 다가오는 콜 한 페이지의 행 수. 달력까지 한 화면에 들어오게 짧게 둔다. */
const MY_UPCOMING_PAGE_SIZE = 5

/** 내 종목의 다가오는 콜 — 다섯 개씩 넘긴다. 다섯 개 이하면 페이지 버튼을 두지 않는다. */
function MyUpcomingPager({
  events,
  tags,
  onPick,
}: {
  events: readonly EarningsEvent[]
  tags: ReadonlyMap<string, MineTag>
  onPick: (ticker: string) => void
}) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(events.length / MY_UPCOMING_PAGE_SIZE))
  // 일정이 갱신돼 페이지 수가 줄면 마지막 페이지로 맞춘다
  const current = Math.min(page, totalPages - 1)
  const shown = events.slice(current * MY_UPCOMING_PAGE_SIZE, (current + 1) * MY_UPCOMING_PAGE_SIZE)

  return (
    <div className="flex flex-col">
      <EventList events={shown} tags={tags} showDate onPick={onPick} />
      {totalPages > 1 && (
        <div className="border-t border-edge/[0.06] [&>div]:py-1.5">
          <Pagination page={current} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}

/** 전체 일정 한 페이지의 행 수. 판이 화면을 넘지 않을 만큼만 둔다. */
const SCHEDULE_PAGE_SIZE = 8

/**
 * 전체 일정 — 행 수로 페이지를 나눠 넘긴다. 시즌에는 수백 건이라 한 판에 다 그리면 홈이 끝없이 길어진다.
 * 판 높이는 한 페이지 분량으로 잡아, 마지막 페이지가 짧아도 페이지 버튼이 위로 튀지 않게 한다.
 */
function SchedulePager({
  groups,
  tags,
  onPick,
}: {
  groups: readonly EarningsGroup[]
  tags: ReadonlyMap<string, MineTag>
  onPick: (ticker: string) => void
}) {
  const pages = useMemo(() => paginateSchedule(groups, SCHEDULE_PAGE_SIZE), [groups])
  const [page, setPage] = useState(0)
  // 일정이 갱신돼 페이지 수가 줄면 마지막 페이지로 맞춘다
  const current = Math.min(page, Math.max(0, pages.length - 1))

  return (
    <div className="flex flex-col">
      <div className="flex flex-col pb-2 min-h-[456px]">
        {(pages[current] ?? []).map((g) => (
          <ScheduleGroupBlock key={`${g.kind}-${g.continued}`} group={g} tags={tags} onPick={onPick} />
        ))}
      </div>
      {pages.length > 1 && (
        <div className="border-t border-edge/[0.06]">
          <Pagination page={current} totalPages={pages.length} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}

function ScheduleGroupBlock({
  group,
  tags,
  onPick,
}: {
  group: SchedulePageGroup<EarningsEvent>
  tags: ReadonlyMap<string, MineTag>
  onPick: (ticker: string) => void
}) {
  // 오늘 · 내일은 묶음 제목이 날짜를 말해 주므로 시각만, 그 뒤는 날짜도 쓴다.
  const showDate = group.kind !== 'today' && group.kind !== 'tomorrow'
  return (
    <div className="flex flex-col">
      <h3 className="px-5 pt-3 pb-1.5 text-[12.5px] font-semibold text-ink-3">
        {group.label}
        <span className="ml-1.5 font-normal tabular-nums">{group.total}</span>
        {group.continued && <span className="ml-1.5 font-normal">· 이어서</span>}
      </h3>
      <EventList events={group.events} tags={tags} showDate={showDate} onPick={onPick} />
    </div>
  )
}

function EventList({
  events,
  tags,
  showDate,
  onPick,
}: {
  events: readonly EarningsEvent[]
  tags: ReadonlyMap<string, MineTag>
  showDate: boolean
  onPick: (ticker: string) => void
}) {
  return (
    <ul className="flex flex-col px-2 pb-2">
      {events.map((e) => {
        const tag = tags.get(e.ticker)
        return (
          <li key={`${e.ticker}-${e.scheduledAt}`}>
            <button
              type="button"
              onClick={() => onPick(e.ticker)}
              className="w-full grid grid-cols-[176px_64px_minmax(0,1fr)_auto_20px] items-center gap-3
                         px-3 py-1.5 rounded-[14px] text-left transition-colors duration-100
                         hover:bg-wash/[0.05] focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
            >
              <span className="text-[13px] text-ink-2 tabular-nums">
                {showDate ? formatDateTime(e.scheduledAt) : formatClock(e.scheduledAt)}
              </span>
              <span className="num text-[14px] font-semibold text-ink-1">{e.ticker}</span>
              <span className="text-[14px] text-ink-2 truncate">{e.name}</span>
              <span>{tag && <Tag tag={tag} />}</span>
              <BellIcon />
              <span className="sr-only">종목 브리핑 열기</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function TimelineError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      message="실적 콜 일정을 불러오지 못했습니다."
      action={
        <button type="button" className="gbtn gbtn-sm" onClick={onRetry}>
          다시 시도
        </button>
      }
    />
  )
}

function Tag({ tag }: { tag: MineTag }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-semibold border
                  ${tag === '보유' ? 'text-ink-1 border-edge/25' : 'text-ink-3 border-edge/10'}`}
    >
      {tag}
    </span>
  )
}

// ── 보조 열 ────────────────────────────────────────────────────────────

/**
 * 계좌 요약. 총자산 · 오늘 손익 · 예수금만 두고 자세한 것은 포트폴리오로 넘긴다.
 * 오늘 손익은 보유 종목의 전일 종가 대비이며, 전일 종가를 모르는 종목이 있으면 계산하지 않는다.
 */
function AccountSummary({
  prices,
  onRetry,
  onMore,
}: {
  prices: Record<string, { currentPrice: number; previousClose: number }>
  onRetry: () => void
  onMore: () => void
}) {
  const account = useOrderAccount()
  const { orderableCash, totalCash, holdings, lastSyncedAt, isSyncing, balanceFetchError } = usePortfolioStore()

  const evaluated = holdings.reduce((sum, h) => sum + h.qty * (prices[h.ticker]?.currentPrice ?? h.currentPrice), 0)
  const totalAsset = totalCash + evaluated

  const canComputeToday = holdings.every((h) => (prices[h.ticker]?.previousClose ?? 0) > 0)
  const todayPnl = canComputeToday
    ? holdings.reduce((sum, h) => {
        const p = prices[h.ticker]!
        return sum + h.qty * (p.currentPrice - p.previousClose)
      }, 0)
    : null

  const neverSynced = lastSyncedAt == null

  return (
    <Panel title="계좌" meta={account ? ACCOUNT_LABELS[account] : '계좌 확인 중'}>
      <div className="px-5 pb-5 flex flex-col gap-4">
        {neverSynced && !balanceFetchError ? (
          <LoadingBlock lines={3} lineHeight={18} />
        ) : neverSynced && balanceFetchError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] text-ink-3">잔고를 불러오지 못했습니다.</p>
            <button type="button" className="gbtn gbtn-sm" onClick={onRetry} disabled={isSyncing}>
              다시 시도
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] text-ink-3">총자산</span>
              <span className="text-[26px] font-semibold tabular-nums tracking-[-0.01em] text-ink-1">
                {formatUsd(totalAsset)}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
              <dt className="text-ink-3">오늘 손익</dt>
              <dd className="text-right tabular-nums">
                {todayPnl == null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span style={{ color: todayPnl > 0 ? 'var(--up)' : todayPnl < 0 ? 'var(--down)' : undefined }}>
                    {todayPnl > 0 ? '+' : todayPnl < 0 ? '−' : ''}
                    {formatUsd(Math.abs(todayPnl))}
                  </span>
                )}
              </dd>
              <dt className="text-ink-3">주문 가능</dt>
              <dd className="text-right tabular-nums text-ink-1">{formatUsd(orderableCash)}</dd>
              <dt className="text-ink-3">보유 종목</dt>
              <dd className="text-right tabular-nums text-ink-1">{holdings.length}개</dd>
            </dl>
            {balanceFetchError && (
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span style={{ color: 'var(--caution)' }}>
                  동기화 실패 · {lastSyncedAt ? `${formatSyncTime(lastSyncedAt)} 값` : '이전 값'}
                </span>
                <button type="button" className="gbtn gbtn-sm" onClick={onRetry} disabled={isSyncing}>
                  다시 시도
                </button>
              </div>
            )}
          </>
        )}
        <button type="button" className="gbtn gbtn-olive gbtn-strong gbtn-sm self-start" onClick={onMore}>
          포트폴리오에서 자세히
        </button>
      </div>
    </Panel>
  )
}

function MarketIndices() {
  const { indices, isLoaded } = useMarketIndices()
  return (
    <Panel title="시장">
      {!isLoaded || indices.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-3">시장 지수를 아직 받지 못했습니다.</p>
      ) : (
        <ul className="px-5 pb-4 flex flex-col">
          {indices.map((it) => (
            <IndexRow key={it.symbol} item={it} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function IndexRow({ item }: { item: MarketIndexItem }) {
  const price =
    item.format === 'percent'
      ? `${item.price.toFixed(2)}%`
      : item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const chg = item.changePercent
  const sign = chg > 0 ? '+' : chg < 0 ? '−' : ''
  // 금리처럼 % 로 표시하는 지표의 등락은 %p 다.
  const chgLabel = `${sign}${Math.abs(chg).toFixed(2)}${item.format === 'percent' ? '%p' : '%'}`
  const isUp = chg > 0
  const isDown = chg < 0
  return (
    <li className="flex items-center justify-between p-2.5 rounded-[12px] bg-wash/[0.02] border border-edge/[0.05] mb-1.5 last:mb-0">
      <div className="flex flex-col">
        <span className="num text-[12.5px] font-bold text-ink-1">{item.symbol}</span>
        <span className="text-[13.5px] tabular-nums font-semibold text-ink-1">{price}</span>
      </div>
      <span
        className={`px-2 py-0.5 rounded-[6px] text-[12px] font-semibold tabular-nums ${
          isUp ? 'text-up bg-up/10' : isDown ? 'text-down bg-down/10' : 'text-ink-3 bg-wash/[0.05]'
        }`}
      >
        {chgLabel}
      </span>
    </li>
  )
}

// ── 공통 ──────────────────────────────────────────────────────────────

function Panel({
  title,
  meta,
  action,
  grow = false,
  children,
}: {
  title: string
  meta?: string
  action?: React.ReactNode
  /** 남은 세로 공간을 채운다(전체 일정 — 창이 크면 달력이 커진다). */
  grow?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={`cloud rounded-[28px] flex flex-col ${grow ? 'flex-1 min-h-0' : ''}`} aria-label={title}>
      <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[16px] font-semibold text-ink-1 on-glass">{title}</h2>
          {meta && <span className="text-[12px] text-ink-3">{meta}</span>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** 콜 시작 알림 자리. 알림 기능이 생기기 전까지 흐리게 둔다. */
function BellIcon() {
  return (
    <span className="text-ink-3 opacity-40" title="콜 시작 알림은 준비 중입니다" aria-hidden>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11zM6.5 14a1.5 1.5 0 0 0 3 0" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const CLOCK = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
const SYNC_TIME = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' })

function formatClock(sec: number): string {
  return CLOCK.format(new Date(sec * 1000))
}

function formatDateTime(sec: number): string {
  return DATE_TIME.format(new Date(sec * 1000))
}

function formatSyncTime(sec: number): string {
  return SYNC_TIME.format(new Date(sec * 1000))
}

function formatUsd(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
