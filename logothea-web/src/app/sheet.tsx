import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { create } from 'zustand'
import { navigate, type Route } from './router'
import { lockScroll } from '../lib/scrollLock'

/**
 * 아래에서 올라오는 시트. 한 번에 하나만 열린다.
 *
 * - 열면 같은 경로로 history 한 단계를 쌓는다. 브라우저 뒤로 가기 · 손잡이 끌어내리기 · 덮개 누르기 · Esc 가
 *   모두 그 단계를 지우며 닫는다(history.back → popstate).
 * - 시트에서 다른 시트를 열면 단계를 더 쌓지 않고 바꾼다. 뒤로 가기 한 번으로 닫힌다.
 * - 시트 안에서 다른 탭으로 갈 때(`콜 보기`)는 쌓인 단계를 그 탭으로 바꾼다. 뒤로 가면 원래 탭이 나온다.
 * - 열리면 포커스를 제목으로, 닫히면 연 자리로 돌린다. iOS Safari 는 탭해도 포커스를 주지 않아 마지막으로 누른
 *   요소를 따로 기억한다. 시트 안에서만 Tab 이 돈다. 뒤 화면 스크롤을 잠근다.
 * - 시트를 연 채 새로고침하면 남은 시트 단계를 지운다. 토큰은 새로고침해도 겹치지 않게 시각에서 시작한다.
 */

export type SheetSize = 'short' | 'tall'

export interface SheetSpec {
  /** 제목. 화면에 그리고 시트 이름(aria-labelledby)으로도 쓴다. */
  title: ReactNode
  /** 제목 옆 작은 글자(예: 원문 용어). */
  subtitle?: ReactNode
  size?: SheetSize
  /** 제목을 화면에 그리지 않을 때(브리핑처럼 머리를 따로 그릴 때). 시트 이름으로는 남는다. */
  hideTitle?: boolean
  /** 본문 · 행동 줄. 훅은 여기서 부르지 말고 컴포넌트 엘리먼트를 돌려준다. */
  body: () => ReactNode
  footer?: () => ReactNode
}

interface SheetState {
  spec: SheetSpec | null
  /** 이 시트가 쌓은 history 단계의 표식. popstate 때 내 단계가 지워졌는지 본다. */
  token: number
  /** 닫은 뒤 포커스를 돌려줄 곳. null 이면 지금 화면의 제목으로 옮긴다. */
  opener: HTMLElement | null
  /** 연 뒤 내용이 정한 높이(예: 브리핑이 오류면 짧게). 없으면 spec.size. */
  sizeOverride: SheetSize | null
}

const useSheetStore = create<SheetState>(() => ({ spec: null, token: 0, opener: null, sizeOverride: null }))
let nextToken = Date.now()
/** history.back() 을 부르고 popstate 를 기다리는 중. 그사이 다시 닫으라고 해도 한 번만 뒤로 간다. */
let closing = false
/** iOS 에서 탭한 요소. 포커스를 주지 않는 브라우저에서 연 자리를 찾는 데 쓴다. */
let lastPressed: HTMLElement | null = null

function focusableOpener(): HTMLElement | null {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) return active
  return lastPressed?.closest<HTMLElement>('button, a[href], [tabindex]') ?? null
}

export function openSheet(spec: SheetSpec): void {
  const current = useSheetStore.getState()
  const token = nextToken++
  closing = false
  if (current.spec) {
    window.history.replaceState({ ...(window.history.state ?? {}), sheet: token }, '')
    useSheetStore.setState({ spec, token, sizeOverride: null })
  } else {
    window.history.pushState({ sheet: token }, '')
    useSheetStore.setState({ spec, token, opener: focusableOpener(), sizeOverride: null })
  }
}

/** 시트를 닫는다. 쌓아 둔 단계를 지우는 것으로 닫으므로 실제로 닫히는 것은 popstate 에서다. */
export function closeSheet(): void {
  const { spec, token } = useSheetStore.getState()
  if (!spec || closing) return
  if ((window.history.state as { sheet?: number } | null)?.sheet === token) {
    closing = true
    window.history.back()
  } else {
    useSheetStore.setState({ spec: null })
  }
}

/** 시트를 닫고 다른 탭으로 간다. 쌓아 둔 단계를 그 탭으로 바꾼다. 포커스는 새 화면의 제목으로 간다. */
export function closeSheetAndGo(route: Route): void {
  closing = false
  useSheetStore.setState({ spec: null, opener: null })
  navigate(route, { replace: true })
}

/** 앱을 띄울 때 한 번 부른다. 새로고침으로 남은 시트 단계를 지우고 popstate · 누른 요소를 지켜본다. */
export function installSheetHistory(): () => void {
  if ((window.history.state as { sheet?: number } | null)?.sheet != null) window.history.replaceState(null, '')
  const onPop = (event: PopStateEvent) => {
    closing = false
    const { spec, token } = useSheetStore.getState()
    if (spec && (event.state as { sheet?: number } | null)?.sheet !== token) useSheetStore.setState({ spec: null })
  }
  const onPointer = (event: PointerEvent) => {
    lastPressed = event.target instanceof HTMLElement ? event.target : null
  }
  window.addEventListener('popstate', onPop)
  document.addEventListener('pointerdown', onPointer, true)
  return () => {
    window.removeEventListener('popstate', onPop)
    document.removeEventListener('pointerdown', onPointer, true)
  }
}

/**
 * 열린 시트의 높이를 내용에 맞게 바꾼다. 긴 시트로 열었는데 오류처럼 내용이 짧으면 짧은 시트(내용 높이)로 줄인다.
 * 시트 본문 안에서 부른다. 시트가 바뀌면(다시 열면) 되돌아간다.
 */
export function useSheetSize(size: SheetSize | null): void {
  useEffect(() => {
    useSheetStore.setState({ sizeOverride: size })
  }, [size])
}

/** 지금 시트가 열려 있는지(훅 밖에서 읽을 때). */
export function isSheetOpen(): boolean {
  return useSheetStore.getState().spec !== null
}

export function useSheetOpen(): boolean {
  return useSheetStore((s) => s.spec !== null)
}

const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 0.6 // px/ms

/** 앱에 하나만 둔다. */
export function SheetHost() {
  const spec = useSheetStore((s) => s.spec)
  const token = useSheetStore((s) => s.token)
  const sizeOverride = useSheetStore((s) => s.sizeOverride)
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const dragStart = useRef<{ y: number; t: number } | null>(null)

  useLayoutEffect(() => {
    if (!spec) return
    if (sheetRef.current) sheetRef.current.style.transform = ''
    titleRef.current?.focus({ preventScroll: true })
  }, [spec, token])

  // 닫히면 연 자리로, 그 자리가 사라졌으면 지금 화면의 제목으로 포커스를 돌린다
  const wasOpen = useRef(false)
  useEffect(() => {
    if (spec) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    const opener = useSheetStore.getState().opener
    useSheetStore.setState({ opener: null })
    requestAnimationFrame(() => {
      const target = opener && document.contains(opener) ? opener : document.querySelector<HTMLElement>('main h1')
      target?.focus({ preventScroll: true })
    })
  }, [spec])

  useEffect(() => (spec ? lockScroll() : undefined), [spec])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeSheet()
      return
    }
    if (event.key !== 'Tab') return
    const root = sheetRef.current
    if (!root) return
    const focusables = [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null)
    if (focusables.length === 0) {
      event.preventDefault()
      titleRef.current?.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  // 끄는 동안의 위치는 DOM 에 바로 쓴다. 상태로 두면 매 프레임 브리핑 본문 전체가 다시 그려진다.
  const setOffset = (y: number, animate: boolean) => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = animate ? 'transform 260ms var(--spring)' : 'none'
    el.style.transform = y > 0 ? `translateY(${y}px)` : ''
  }
  const onPointerDown = (event: React.PointerEvent) => {
    dragStart.current = { y: event.clientY, t: performance.now() }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current
    if (start) setOffset(Math.max(0, event.clientY - start.y), false)
  }
  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    const distance = Math.max(0, event.clientY - start.y)
    const elapsed = Math.max(1, performance.now() - start.t)
    if (distance > CLOSE_DISTANCE || (distance > 24 && distance / elapsed > CLOSE_VELOCITY)) closeSheet()
    else setOffset(0, true)
  }

  // 본문 · 행동 줄 엘리먼트는 시트가 바뀔 때만 만든다
  const body = useMemo(() => spec?.body(), [spec])
  const footer = useMemo(() => spec?.footer?.(), [spec])

  if (!spec) return null
  const size = sizeOverride ?? spec.size ?? 'short'
  const titleId = `sheet-title-${token}`
  return (
    <>
      <div className="sheet-scrim" data-size={size} onClick={closeSheet} aria-hidden="true" />
      <div
        ref={sheetRef}
        className="sheet read"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div
          className="sheet-grab-zone"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStart.current = null
            setOffset(0, true)
          }}
        >
          <span className="sheet-grab" />
        </div>
        <h2 ref={titleRef} id={titleId} tabIndex={-1} className={spec.hideTitle ? 'sr-only' : undefined}>
          {spec.title}
          {spec.subtitle && <small className="sheet-subtitle">{spec.subtitle}</small>}
        </h2>
        <div className="sheet-body">{body}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
        <button type="button" className="sr-only" onClick={closeSheet}>
          닫기
        </button>
      </div>
    </>
  )
}
