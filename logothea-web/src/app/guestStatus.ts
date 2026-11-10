import { useSyncExternalStore } from 'react'
import type { GuestStatus } from '../data/auth'
import { guest } from '../data/runtime'

// 렌더마다 구독을 다시 걸지 않도록 함수를 모듈에 둔다
const subscribe = (listener: () => void) => (guest ? guest.onStatus(listener) : () => undefined)
const snapshot = () => guest?.status ?? null

/** 게스트 토큰 상태. 개발 토큰으로 띄운 개발 서버면 null. */
export function useGuestStatus(): GuestStatus | null {
  return useSyncExternalStore(subscribe, snapshot)
}

/** 게스트 토큰을 받지 못해 인증이 필요한 데이터(일정 · 사전 · 방송 상태 등)를 받을 수 없는 상태. */
export function isGuestBlocked(status: GuestStatus | null): boolean {
  return status === 'disabled' || status === 'rate_limited' || status === 'unavailable'
}
