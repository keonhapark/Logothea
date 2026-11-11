import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { markCallTourDone } from '../../lib/callTour'

interface TourStep {
  /** 비출 곳. 화면에 없으면 그 단계를 건너뛴다. */
  selector: string
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="transcript"]',
    title: '자막',
    body: '콜의 발언이 실시간으로 쌓입니다. 직전 콜과 달라진 대목에는 발언 아래에 표시가 붙습니다.',
  },
  {
    selector: '[data-tour="side"]',
    title: '대조',
    body: '직전 콜과 달라진 대목을 한곳에 모아 봅니다. 누르면 자막의 그 발언으로 옮겨 갑니다.',
  },
  {
    selector: '[data-tour="side-tabs"]',
    title: 'AI 어시스턴트',
    body: 'AI 어시스턴트 탭에서 지금까지 나온 콜 내용에 대해 묻습니다. 자막의 "이 대목 질문"으로 범위를 좁힐 수도 있습니다.',
  },
  {
    selector: '[data-order-toggle]',
    title: '주문',
    body: '보고 있는 종목을 바로 주문합니다. 설정에서 고른 계좌(모의 · 실전)로 나갑니다.',
  },
]

const CARD_W = 340
const GAP = 24
const MARGIN = 16

interface Box {
  top: number
  left: number
  width: number
  height: number
}

/**
 * 콜 화면 첫 사용 안내 — 자막 · 대조 · 질문 · 주문을 차례로 비춘다.
 *
 *  - 처음 한 번만 뜬다(lib/callTour). 끝내거나 건너뛰면 다시 뜨지 않고, 설정에서 다시 볼 수 있다.
 *  - 비추는 곳 밖은 어둡게 덮고, 아래 화면(#root)은 inert 로 막는다. Esc 는 건너뛰기다.
 *  - 설명 카드는 읽는 유리(.read), 비추는 테두리는 금테다.
 */
export default function CallTour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((s) => document.querySelector(s.selector))
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const step = steps[index]

  const finish = useCallback(() => {
    markCallTourDone()
    onClose()
  }, [onClose])

  // 비출 곳이 하나도 없으면 띄우지 않고 닫는다(본 것으로 기록하지 않는다)
  const empty = steps.length === 0
  useEffect(() => {
    if (empty) onClose()
  }, [empty, onClose])

  // 안내가 떠 있는 동안 아래 화면은 키보드 · 화면 읽기 도구로도 닿지 않게 한다. 닫히면 포커스를 되돌린다.
  useEffect(() => {
    if (empty) return
    const root = document.getElementById('root')
    const lastFocus = document.activeElement as HTMLElement | null
    if (root) root.inert = true
    return () => {
      if (root) root.inert = false
      if (lastFocus?.isConnected) lastFocus.focus()
    }
  }, [empty])

  // 칸 너비는 콜이 시작될 때 500ms 동안 바뀐다. 크기가 바뀌는 동안 계속 다시 잰다.
  useLayoutEffect(() => {
    if (!step) return
    const el = document.querySelector(step.selector)
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [step])

  const hasBox = box !== null
  useEffect(() => {
    if (hasBox) nextRef.current?.focus()
  }, [index, hasBox])

  useEffect(() => {
    if (empty) return
    // 아래에 열린 시트 · 대화상자가 같은 Esc 로 함께 닫히지 않도록 먼저 받아 멈춘다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish()
        return
      }
      // Tab 은 카드의 버튼 사이에서만 돈다
      if (e.key === 'Tab') {
        const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        if (buttons.length === 0) return
        e.preventDefault()
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        buttons[next].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [empty, finish])

  if (!step) return null
  if (!box) return null

  const last = index === steps.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 오른쪽에 자리가 있으면 오른쪽, 없으면 왼쪽, 둘 다 없으면 비추는 곳 안쪽 아래에 둔다
  const left =
    box.left + box.width + GAP + CARD_W <= vw - MARGIN
      ? box.left + box.width + GAP
      : box.left - GAP - CARD_W >= MARGIN
        ? box.left - GAP - CARD_W
        : Math.min(vw - CARD_W - MARGIN, Math.max(MARGIN, box.left + box.width - CARD_W - MARGIN))
  const top = Math.min(vh - 220 - MARGIN, Math.max(MARGIN, box.top + Math.min(120, box.height / 3)))

  return createPortal(
    // 바깥을 눌러도 아래 화면에 닿지 않도록 화면 전체를 덮는다
    <div className="fixed inset-0 z-[250]">
      {/* 비추는 곳 — 바깥은 큰 그림자로 어둡게 덮는다 */}
      <div
        aria-hidden
        className="absolute rounded-[28px] pointer-events-none transition-all duration-300 motion-reduce:transition-none"
        style={{
          top: box.top - 4,
          left: box.left - 4,
          width: box.width + 8,
          height: box.height + 8,
          boxShadow: '0 0 0 4000px rgb(var(--scrim-rgb) / 0.6), 0 0 0 2px rgb(var(--gold-rgb) / 0.8)',
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-tour-title"
        aria-describedby="call-tour-body"
        className="read absolute rounded-[24px] p-[22px] text-ink-1"
        style={{ top, left, width: CARD_W }}
      >
        {/* 포커스가 같은 버튼에 머물러도 단계가 바뀐 것을 읽어 주도록 알린다 */}
        <div aria-live="polite">
          <div className="text-[12px] text-ink-3 tabular-nums">
            {index + 1} / {steps.length}
          </div>
          <h2 id="call-tour-title" className="text-[17px] font-bold mt-1 mb-2">
            {step.title}
          </h2>
          <p id="call-tour-body" className="text-[13.5px] leading-[1.6] text-ink-2">
            {step.body}
          </p>
        </div>
        <div className="flex justify-between mt-[18px]">
          {last ? (
            <span />
          ) : (
            <button type="button" className="gbtn gbtn-sm" onClick={finish}>
              건너뛰기
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            className="gbtn gbtn-sm gbtn-lapis"
            onClick={() => (last ? finish() : setIndex((i) => i + 1))}
          >
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
