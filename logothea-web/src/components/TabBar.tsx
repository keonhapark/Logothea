import { useEffect, useState, type MouseEvent } from 'react'
import { navigate, ROUTES, type Route } from '../app/router'
import { useBroadcastView } from '../app/broadcast'

/** 아이콘은 시안(.scratch/web-mobile-mockup.html)의 채운 모양 SVG 경로 그대로다. */
const TABS: Record<Route, { label: string; icon: JSX.Element }> = {
  '/': {
    label: '홈',
    icon: <path d="M12 3.2 3 10.4V20a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1v-9.6z" />,
  },
  '/market': {
    label: '시장',
    icon: (
      <>
        <rect x="3.5" y="12" width="4.2" height="9" rx="1.2" />
        <rect x="9.9" y="7" width="4.2" height="14" rx="1.2" />
        <rect x="16.3" y="3" width="4.2" height="18" rx="1.2" />
      </>
    ),
  },
  '/call': {
    label: '콜',
    icon: (
      <>
        <rect x="2.5" y="10" width="2.4" height="4" rx="1.2" />
        <rect x="6.6" y="6.5" width="2.4" height="11" rx="1.2" />
        <rect x="10.8" y="3" width="2.4" height="18" rx="1.2" />
        <rect x="15" y="6" width="2.4" height="12" rx="1.2" />
        <rect x="19.1" y="9" width="2.4" height="6" rx="1.2" />
      </>
    ),
  },
  '/me': {
    label: '내 정보',
    icon: (
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.6 3.6 0 1 1 0 7.2A3.6 3.6 0 0 1 12 6zm0 14a8 8 0 0 1-6.1-2.8c1.3-1.7 3.5-2.6 6.1-2.6s4.8.9 6.1 2.6A8 8 0 0 1 12 20z"
      />
    ),
  },
}

/**
 * 아래 탭 바. 고른 탭은 밝은 렌즈가 채우고, 탭을 바꾸면 렌즈가 스프링으로 미끄러진다(모션 줄이기면 바로).
 * 글 입력칸에 포커스가 있는 동안(키보드가 올라온 동안)은 감춘다.
 */
export default function TabBar({ route }: { route: Route }) {
  const live = useBroadcastView().kind === 'live'
  const typing = useTextInputFocused()
  const index = ROUTES.indexOf(route)

  const go = (event: MouseEvent<HTMLAnchorElement>, target: Route) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(target)
    window.scrollTo({ top: 0 })
  }

  return (
    <nav className="tabbar glass" aria-label="화면" data-hidden={typing}>
      <span className="tabbar-lens" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
      {ROUTES.map((target) => {
        const tab = TABS[target]
        const showLive = target === '/call' && live
        return (
          <a
            key={target}
            href={target}
            className="tab"
            aria-current={target === route ? 'page' : undefined}
            onClick={(event) => go(event, target)}
            tabIndex={typing ? -1 : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {tab.icon}
            </svg>
            {tab.label}
            {showLive && (
              <>
                <span className="ldot" aria-hidden="true" />
                <span className="sr-only">방송 중</span>
              </>
            )}
          </a>
        )
      })}
    </nav>
  )
}

/** 글을 쓰는 칸(input · textarea)에 포커스가 있는지. 모바일에서는 그동안 화면 키보드가 올라와 있다. */
function useTextInputFocused(): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const isText = (el: Element | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type))
    const update = () => setFocused(isText(document.activeElement))
    // focusout 시점에는 다음 포커스가 아직 정해지지 않았다. 한 틱 뒤에 본다
    let timer = 0
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 0)
    }
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', later)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', later)
    }
  }, [])
  return focused
}
