import { useSyncExternalStore } from 'react'

/**
 * 경로 네 개와 시트 한 단계만 다루는 라우팅. react-router 없이 History API 를 쓴다.
 *
 * - 탭 전환은 pushState 로 경로를 바꾼다. 브라우저 뒤로 가기가 이전 탭으로 돌아간다.
 * - 시트를 열면 같은 경로로 한 단계를 더 쌓는다(state.sheet). 뒤로 가기는 그 단계를 지우며 시트를 닫는다(sheet.tsx).
 * - 모르는 경로는 홈으로 바꾼다(replaceState). Cloudflare Pages 의 _redirects 가 모든 경로를 index.html 로 보낸다.
 */

export type Route = '/' | '/market' | '/call' | '/me'
export const ROUTES: readonly Route[] = ['/', '/market', '/call', '/me']

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/'
}

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify)
  const route = parseRoute(window.location.pathname)
  if (route !== window.location.pathname) window.history.replaceState(window.history.state, '', route)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): Route {
  return parseRoute(window.location.pathname)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, () => '/')
}

/** 다른 탭으로 간다. 같은 탭이면 쌓지 않는다. replace 면 지금 단계를 바꾼다(시트에서 다른 탭으로 갈 때). */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  if (!options.replace && parseRoute(window.location.pathname) === route) return
  if (options.replace) window.history.replaceState(null, '', route)
  else window.history.pushState(null, '', route)
  notify()
}
