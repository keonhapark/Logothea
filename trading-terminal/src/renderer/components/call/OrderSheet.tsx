import { useEffect, useMemo, useRef, useState } from 'react'
import SegmentedControl from '../common/SegmentedControl'
import Stepper from '../common/Stepper'
import SessionOrderList from './SessionOrderList'
import { useRefraction } from '../../lib/refraction'
import { maxOrderQty } from '../../lib/callScreen'
import type { SessionOrder } from '../../lib/sessionOrders'
import type { OrderAccount } from '../../hooks/useOrderAccount'
import { IMMEDIATE_FILL_BUFFER, immediateFillPrice } from '../../../lib/orderPricing'

export type OrderSide = 'BUY' | 'SELL'

export interface OrderSubmitPayload {
  side: OrderSide
  qty: number
  /** 즉시 체결 = null (main 이 현재가 기준 버퍼 지정가로 환산), 지정가 = 가격값. */
  price: number | null
}


interface OrderSheetProps {
  open: boolean
  onClose: () => void
  ticker: string
  currentPrice: number | null
  orderableCash: number
  /** 이 종목 보유 수량. 잔고를 못 불러왔으면 null. */
  heldQty: number | null
  /** 계좌를 아직 모르면 null — 모르는 채로 주문을 보내지 않는다. */
  account: OrderAccount | null
  /** KIS 계좌인데 키가 없으면 false. 이때는 입력 대신 키 등록 안내를 보인다. */
  hasKey: boolean
  onOpenSettings: () => void
  /** 전송. 성공 · 실패 기록은 호출 측이 남기고, 남긴 기록을 돌려준다(영수증에 쓴다). */
  onSubmit: (payload: OrderSubmitPayload) => Promise<SessionOrder | null>
  submitting: boolean
  orders: readonly SessionOrder[]
  onRefreshOrders: () => void
  refreshingOrders: boolean
  /** 콜 바 아래에서 시작하도록 비워 두는 높이(px). */
  topInset: number
}

/** 지정가 입력 상한 (USD/주). 비현실적인 값이 들어와 예상 금액이 Infinity 가 되는 것을 막는다. */
const MAX_LIMIT_PRICE = 1_000_000

const ACCOUNT_META: Record<OrderAccount, { title: string; note: string }> = {
  KIS_PAPER: { title: 'KIS 모의투자 계좌', note: '모의투자 서버로 주문합니다. 실제 돈은 움직이지 않습니다.' },
  KIS_REAL: { title: 'KIS 실전투자 계좌', note: '실제 돈으로 주문합니다. 체결되면 되돌릴 수 없습니다.' },
  SELF_PAPER: { title: '페이퍼 계정', note: '증권사를 거치지 않고 현재가로 가상 체결합니다.' },
}

const SIDE_ITEMS: { id: OrderSide; label: string }[] = [
  { id: 'BUY', label: '매수' },
  { id: 'SELL', label: '매도' },
]

const TYPE_ITEMS: { id: 'IMMEDIATE' | 'LIMIT'; label: string }[] = [
  { id: 'IMMEDIATE', label: '즉시 체결' },
  { id: 'LIMIT', label: '지정가' },
]

function usd(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * 주문 시트 — 콜 화면을 떠나지 않고 여는 보조 패널 (docs/design/ux.md 주문).
 *
 *  - 맨 위에 주문이 나가는 계좌(모의 · 실전 · 페이퍼)를 크게 쓴다.
 *  - `즉시 체결` 은 시장가가 아니라 현재가 ±1% 지정가라는 점을 화면에 둔다.
 *  - 전송 전에 확인 단계를 늘 거친다. 실전 계좌의 전송 버튼은 위험 행동(포르피라)이다.
 *  - 매도의 최대 수량은 보유 수량이다.
 *  - 콜 화면의 내용 위에 떠 있어 굴절을 건다. 읽고 입력하는 면이라 맑은 유리가 아니라 서리 유리이고,
 *    금테는 화면 중심 판의 2.2px 이다. 콜 바 아래에서 시작해 콜 바의 `주문` 버튼을 가리지 않는다.
 */
export default function OrderSheet(props: OrderSheetProps) {
  if (!props.open) return null
  return <OpenSheet {...props} />
}

/** 열렸을 때만 마운트한다 — 굴절 맵은 마운트된 요소의 크기로 만든다. */
/** 시트를 여닫는 버튼에 붙이는 표시. 바깥 클릭 판정에서 이 버튼은 뺀다(눌러서 닫는 것은 버튼이 한다). */
export const ORDER_TOGGLE_ATTR = 'data-order-toggle'

function OpenSheet(props: OrderSheetProps) {
  const { onClose, topInset } = props
  const ref = useRef<HTMLDivElement>(null)
  useRefraction(ref, 24)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 바깥을 누르면 닫는다. 덮개를 깔지 않아 시트가 열린 동안에도 자막 스크롤 · 콜 바를 그대로 쓴다.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || ref.current?.contains(target)) return
      if (target.closest(`[${ORDER_TOGGLE_ATTR}]`)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    // 닫히면 연 버튼으로 포커스를 돌려준다.
    const opener = document.activeElement as HTMLElement | null
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
      if (opener && opener.isConnected) opener.focus()
    }
  }, [onClose])

  // 머리 부분을 잡고 끌어 옮긴다. 열 때마다 제자리(콜 바 아래 오른쪽)에서 시작한다.
  // 들어오는 애니메이션이 transform 을 쓰므로 위치는 translate 로 따로 준다.
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const stopDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDrag.current?.(), [])
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as Element
    if (e.button !== 0 || !target.closest('header') || target.closest('button, input, a')) return
    const el = ref.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    e.preventDefault()
    // 포인터를 붙잡아 창 밖에서 놓아도 끝이 온다.
    el.setPointerCapture(e.pointerId)
    const start = { px: e.clientX, py: e.clientY, x: offset.x, y: offset.y }
    const r = el.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const MARGIN = 12
    // 끌기 시작한 순간의 시트 자리에서 부모 판 안쪽까지만 움직인다.
    const lim = {
      minX: start.x + (pr.left + MARGIN - r.left),
      maxX: start.x + (pr.right - MARGIN - r.right),
      // 콜 바(위쪽 topInset)는 덮지 않는다 — 콜 바의 `주문` 버튼으로 닫을 수 있어야 한다.
      minY: start.y + (pr.top + topInset - r.top),
      maxY: start.y + (pr.bottom - MARGIN - r.bottom),
    }
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) return onUp()
      setOffset({
        x: clamp(start.x + ev.clientX - start.px, lim.minX, lim.maxX),
        y: clamp(start.y + ev.clientY - start.py, lim.minY, lim.maxY),
      })
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('lostpointercapture', onUp)
      stopDrag.current = null
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('lostpointercapture', onUp)
    stopDrag.current = onUp
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby="order-sheet-title"
      onPointerDown={startDrag}
      className="read absolute right-3 z-30 w-[400px] rounded-[30px] flex flex-col overflow-hidden animate-slide-in-top [-webkit-app-region:no-drag]"
      style={{
        top: topInset,
        translate: `${offset.x}px ${offset.y}px`,
        // 아래로 옮긴 만큼 최대 높이를 줄여 창 밖으로 나가지 않게 한다.
        maxHeight: `calc(100% - ${topInset + 12 + Math.max(0, offset.y)}px)`,
      }}
    >
      <SheetBody {...props} />
    </div>
  )
}

function SheetBody({
  onClose,
  ticker,
  currentPrice,
  orderableCash,
  heldQty,
  account,
  hasKey,
  onOpenSettings,
  onSubmit,
  submitting,
  orders,
  onRefreshOrders,
  refreshingOrders,
}: OrderSheetProps) {
  const [side, setSide] = useState<OrderSide>('BUY')
  const [type, setType] = useState<'IMMEDIATE' | 'LIMIT'>('IMMEDIATE')
  const [qty, setQty] = useState(1)
  const [limitPrice, setLimitPrice] = useState('')
  const [confirming, setConfirming] = useState(false)

  const hasPrice = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0

  // 실제로 나갈 단가. 즉시 체결은 main 이 주문 시점 현재가로 다시 계산하지만, 예상 금액 · 최대 수량은
  // 버퍼가 얹힌 가격을 기준으로 보여 줘야 예수금 부족 거부를 피할 수 있다.
  const unitPrice = useMemo(() => {
    if (type === 'IMMEDIATE') return hasPrice ? immediateFillPrice(side, currentPrice as number) : null
    const parsed = parseFloat(limitPrice)
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= MAX_LIMIT_PRICE) return null
    return parsed
  }, [type, hasPrice, side, currentPrice, limitPrice])

  const maxQty = maxOrderQty({ side, unitPrice, orderableCash, heldQty })
  const total = unitPrice != null ? unitPrice * qty : null
  const overMax = maxQty != null && qty > maxQty
  // 보유 수량을 모르면 매도를 막는다 — 모르는 채로 보내면 가진 것보다 많이 팔 수 있다.
  const sellUnknown = side === 'SELL' && heldQty == null
  const canReview =
    account !== null &&
    Number.isInteger(qty) &&
    qty > 0 &&
    unitPrice != null &&
    !overMax &&
    !sellUnknown &&
    !submitting
  const needsKey = account !== null && account !== 'SELF_PAPER' && !hasKey

  // 보내기 반응: 링이 차오르고(run) → 접수되면 닫히며 체크(ok) → 영수증이 올라온다.
  const [sendPhase, setSendPhase] = useState<'idle' | 'run' | 'ok'>('idle')
  const [receipt, setReceipt] = useState<{ order: SessionOrder; price: number | null } | null>(null)
  const [receiptIn, setReceiptIn] = useState(false)
  const timers = useRef<number[]>([])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      timers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  async function send() {
    // 확인 화면에 있는 동안 예수금 · 보유 · 가격이 바뀌었을 수 있다. 보내기 직전에 다시 본다.
    if (!canReview || sendPhase !== 'idle') return
    const sentPrice = unitPrice
    setSendPhase('run')
    let order: SessionOrder | null = null
    try {
      order = await onSubmit({ side, qty, price: type === 'IMMEDIATE' ? null : unitPrice })
    } catch {
      order = null
    }
    // 보내는 사이 시트가 닫혔으면 여기서 멈춘다. 주문 결과는 호출 측이 목록에 남긴다.
    if (!mounted.current) return
    if (!order || order.status === 'FAILED') {
      // 실패는 호출 측이 토스트로 알리고 주문 목록에 남긴다. 입력 화면으로 돌아간다.
      setSendPhase('idle')
      setConfirming(false)
      return
    }
    const done = order
    setSendPhase('ok')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timers.current.push(
      window.setTimeout(() => {
        setReceipt({ order: done, price: sentPrice })
        requestAnimationFrame(() => requestAnimationFrame(() => setReceiptIn(true)))
      }, reduce ? 0 : 900),
    )
  }

  function closeReceipt() {
    setReceiptIn(false)
    setReceipt(null)
    setSendPhase('idle')
    setConfirming(false)
    setQty(1)
  }

  const receiptTitleRef = useRef<HTMLSpanElement>(null)
  // 영수증이 덮은 동안 아래 입력에 Tab 이 닿지 않게 한다(React 18 타입에 inert 가 없어 직접 단다).
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.toggleAttribute('inert', receipt != null)
    // inert 가 붙으면 보내기 버튼에 있던 포커스가 빠진다. 바로 영수증 제목으로 옮긴다.
    if (receipt) receiptTitleRef.current?.focus({ preventScroll: true })
  }, [receipt])

  // 단계가 바뀌면 누른 버튼이 사라진다. 포커스를 새 단계의 제목으로 옮긴다.
  const titleRef = useRef<HTMLSpanElement>(null)
  const confirmTitleRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    ;(confirming ? confirmTitleRef.current : titleRef.current)?.focus()
  }, [confirming])

  const meta = account ? ACCOUNT_META[account] : null
  const sideWord = side === 'BUY' ? '매수' : '매도'
  const bufferPct = (IMMEDIATE_FILL_BUFFER * 100).toFixed(0)

  return (
    <>
      <header className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 cursor-grab active:cursor-grabbing select-none" title="끌어서 옮기기">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">
            <span className="num text-ink-1 font-semibold">{ticker}</span> 주문
          </span>
          <span id="order-sheet-title" ref={titleRef} tabIndex={-1} className="text-[19px] font-bold text-ink-1 outline-none">
            {meta ? meta.title : '계좌 확인 중'}
          </span>
          {meta && (
            <span className={`text-[12.5px] leading-snug ${account === 'KIS_REAL' ? 'text-warning' : 'text-ink-3'}`}>
              {meta.note}
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="gbtn gbtn-icon gbtn-sm shrink-0" aria-label="주문 닫기">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className={`order-body min-h-0 overflow-y-auto px-6 pb-6 flex flex-col gap-5 ${receipt ? 'is-away' : ''}`} ref={bodyRef}>
        {needsKey ? (
          <div className="flex flex-col gap-3 py-4">
            <p className="text-[14px] text-ink-1 leading-relaxed">KIS 키를 등록하면 이 자리에서 주문할 수 있습니다.</p>
            <button type="button" className="gbtn gbtn-lapis self-start" onClick={onOpenSettings}>
              KIS 키 등록
            </button>
          </div>
        ) : confirming ? (
          <div className="flex flex-col gap-4">
            <span ref={confirmTitleRef} tabIndex={-1} className="text-[17px] font-bold text-ink-1 outline-none">
              주문을 보낼까요?
            </span>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
              <dt className="text-ink-3">계좌</dt>
              <dd className="text-right text-ink-1">{meta?.title}</dd>
              <dt className="text-ink-3">종목</dt>
              <dd className="num text-right text-ink-1">{ticker}</dd>
              <dt className="text-ink-3">방향</dt>
              <dd className="text-right font-semibold" style={{ color: side === 'BUY' ? 'var(--up)' : 'var(--down)' }}>
                {sideWord}
              </dd>
              <dt className="text-ink-3">수량</dt>
              <dd className="tabular-nums text-right text-ink-1">{qty.toLocaleString()}주</dd>
              <dt className="text-ink-3">가격</dt>
              <dd className="tabular-nums text-right text-ink-1">
                {unitPrice != null ? usd(unitPrice) : '—'}
                <span className="text-ink-3 text-[12px]"> {type === 'IMMEDIATE' ? '지정가 (즉시 체결)' : '지정가'}</span>
              </dd>
              <dt className="text-ink-3">예상 금액</dt>
              <dd className="tabular-nums text-right text-ink-1 font-semibold">{total != null ? usd(total) : '—'}</dd>
            </dl>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className={`gbtn send-cancel flex-1 ${sendPhase !== 'idle' ? 'is-gone' : ''}`}
                onClick={() => setConfirming(false)}
                disabled={submitting || sendPhase !== 'idle'}
              >
                취소
              </button>
              <div className="relative flex-1 flex justify-center">
                <button
                  type="button"
                  className={`gbtn send-btn ${account === 'KIS_REAL' ? 'gbtn-porphyra' : 'gbtn-lapis'} ${
                    sendPhase === 'run' ? 'is-run' : sendPhase === 'ok' ? 'is-ok' : ''
                  }`}
                  onClick={() => void send()}
                  disabled={sendPhase === 'idle' && !canReview}
                  aria-label={sendPhase === 'idle' ? undefined : sendPhase === 'run' ? '주문을 보내는 중' : '주문 접수됨'}
                >
                  {sendPhase === 'idle' ? (
                    '주문 보내기'
                  ) : sendPhase === 'ok' ? (
                    <svg className="send-check w-[18px] h-[18px]" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </button>
                <svg
                  className={`send-ring ${sendPhase !== 'idle' ? 'is-on' : ''} ${sendPhase === 'ok' ? 'is-done' : ''}`}
                  viewBox="0 0 54 54"
                  aria-hidden="true"
                  style={{ ['--p' as string]: sendPhase === 'run' ? 0.85 : sendPhase === 'ok' ? 1 : 0 }}
                >
                  <circle className="t" cx="27" cy="27" r="25" />
                  <circle className="p" cx="27" cy="27" r="25" pathLength={100} />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <SegmentedControl items={SIDE_ITEMS} activeId={side} onChange={setSide} className="self-start" />

            <div className="flex flex-col gap-2">
              <span className="text-[12.5px] text-ink-3">수량</span>
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Stepper value={qty} min={1} max={Math.max(1, maxQty ?? 99999)} onChange={(v) => setQty(Math.max(1, Math.floor(v)))} ariaLabel="주문 수량" suffix="주" />
                </div>
                <button
                  type="button"
                  className="gbtn gbtn-sm"
                  onClick={() => maxQty && maxQty > 0 && setQty(maxQty)}
                  disabled={!maxQty}
                >
                  최대
                </button>
              </div>
              <span className="text-[12px] text-ink-3">
                {side === 'BUY'
                  ? maxQty == null
                    ? '가격을 알 수 없어 최대 수량을 계산하지 못했습니다'
                    : `최대 매수 ${maxQty.toLocaleString()}주`
                  : heldQty == null
                    ? '잔고를 불러오지 않아 보유 수량을 모릅니다'
                    : `보유 ${heldQty.toLocaleString()}주까지 팔 수 있습니다`}
              </span>
              {overMax && <span className="text-[12px] text-danger">최대 수량을 넘었습니다.</span>}
              {sellUnknown && <span className="text-[12px] text-danger">보유 수량을 확인한 뒤 매도할 수 있습니다.</span>}
            </div>

            <div className="flex flex-col gap-2">
              <SegmentedControl items={TYPE_ITEMS} activeId={type} onChange={setType} className="self-start" />
              {type === 'IMMEDIATE' ? (
                <p className="text-[12.5px] text-ink-2 leading-relaxed">
                  미국 주식은 시장가 주문이 없어 현재가보다 {bufferPct}% {side === 'BUY' ? '높은' : '낮은'} 지정가
                  {unitPrice != null && <span className="tabular-nums text-ink-1"> {usd(unitPrice)}</span>}로 냅니다.
                </p>
              ) : (
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={hasPrice ? (currentPrice as number).toFixed(2) : '0.00'}
                  min={0}
                  max={MAX_LIMIT_PRICE}
                  step="0.01"
                  className="input-base tabular-nums w-40 text-right"
                  aria-label="지정가"
                />
              )}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13.5px] border-t border-border-subtle pt-4">
              <dt className="text-ink-3">예상 금액</dt>
              <dd className="tabular-nums text-right text-ink-1 font-semibold">{total != null ? usd(total) : '—'}</dd>
              <dt className="text-ink-3">예수금</dt>
              <dd className="tabular-nums text-right text-ink-2">{usd(orderableCash)}</dd>
            </dl>

            <button
              type="button"
              className="gbtn gbtn-lapis w-full"
              disabled={!canReview}
              onClick={() => setConfirming(true)}
            >
              {sideWord} 확인
            </button>
          </div>
        )}

        <div className="border-t border-border-subtle pt-4">
          <SessionOrderList orders={orders} onRefresh={onRefreshOrders} refreshing={refreshingOrders} />
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {sendPhase === 'run' ? '주문을 보내는 중입니다' : sendPhase === 'ok' ? '주문이 접수되었습니다' : ''}
      </p>

      {receipt && (
        <OrderReceipt
          order={receipt.order}
          sentPrice={receipt.price}
          ticker={ticker}
          accountTitle={meta?.title ?? ''}
          shown={receiptIn}
          titleRef={receiptTitleRef}
          onClose={closeReceipt}
        />
      )}
    </>
  )
}

function clock(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * 접수 영수증 — 시트 틀은 유리 그대로 두고, 영수증만 클레이(작은 구름)로 아래에서 올라온다.
 * 입력 화면 대신 자리를 차지해 시트 높이가 영수증에 맞춰진다.
 */
function OrderReceipt({
  order,
  sentPrice,
  ticker,
  accountTitle,
  shown,
  titleRef,
  onClose,
}: {
  order: SessionOrder
  /** 보낸 단가. 즉시 체결도 버퍼가 얹힌 지정가로 나간다. */
  sentPrice: number | null
  ticker: string
  accountTitle: string
  shown: boolean
  titleRef: React.RefObject<HTMLSpanElement>
  onClose: () => void
}) {
  const executed = order.status === 'EXECUTED'
  const price = executed ? order.executedPrice : order.requestedPrice ?? sentPrice
  return (
    <div
      className={`receipt cloud-s shrink-0 mx-4 mb-4 rounded-[24px] px-6 pt-6 pb-5 flex flex-col ${shown ? 'is-in' : ''}`}
      role="group"
      aria-labelledby="order-receipt-title"
    >
      <span
        className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full"
        style={{ background: 'var(--lapis)', color: 'var(--on-lapis)', boxShadow: '0 0 0 7px rgb(var(--lapis-rgb) / 0.14)' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span id="order-receipt-title" ref={titleRef} tabIndex={-1} className="text-center text-[18px] font-bold text-ink-1 outline-none">
        {executed ? '체결되었습니다' : '주문을 접수했습니다'}
      </span>
      <span className="text-center text-[12.5px] text-ink-3 mt-1">
        {accountTitle}
        {!executed && ' · 체결되면 알려 드립니다'}
      </span>
      <div className="receipt-tear my-4" aria-hidden="true" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13.5px]">
        <dt className="text-ink-3">종목</dt>
        <dd className="num text-right text-ink-1 font-semibold">{ticker}</dd>
        <dt className="text-ink-3">방향</dt>
        <dd className="text-right font-semibold" style={{ color: order.side === 'BUY' ? 'var(--up)' : 'var(--down)' }}>
          {order.side === 'BUY' ? '매수' : '매도'}
        </dd>
        <dt className="text-ink-3">수량</dt>
        <dd className="tabular-nums text-right text-ink-1">
          {(executed ? order.executedQty : order.qty).toLocaleString()}주
        </dd>
        <dt className="text-ink-3">{executed ? '체결가' : '가격'}</dt>
        <dd className="tabular-nums text-right text-ink-1">
          {price != null ? usd(price) : '—'}
          {!executed && order.requestedPrice == null && <span className="text-ink-3 text-[12px]"> 지정가 (즉시 체결)</span>}
        </dd>
        <dt className="text-ink-3">주문번호</dt>
        <dd className="num text-right text-ink-1">{order.brokerOrderId ?? '—'}</dd>
        <dt className="text-ink-3">시각</dt>
        <dd className="tabular-nums text-right text-ink-2">{clock(order.placedAt)}</dd>
      </dl>
      <button type="button" className="gbtn w-full mt-5" onClick={onClose}>
        확인
      </button>
    </div>
  )
}
