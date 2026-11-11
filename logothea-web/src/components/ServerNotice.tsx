import type { GuestStatus } from '../data/auth'
import { useGuestStatus } from '../app/guestStatus'

/** 게스트 토큰을 받지 못한 이유별 덧붙임 문구. 주 문구는 하나("지금은 서버에 연결할 수 없습니다")다. */
export const GUEST_NOTICE: Partial<Record<GuestStatus, string>> = {
  disabled: '전시 서버가 열려 있지 않습니다. 잠시 뒤 페이지를 새로 고쳐 주세요.',
  rate_limited: '접속이 몰려 있습니다. 잠시 뒤 다시 연결합니다.',
  unavailable: '잠시 뒤 다시 연결합니다.',
}

/**
 * 홈 맨 위의 짧은 연결 안내. 게스트 토큰을 받지 못했을 때만 보인다(404 발급 꺼짐 · 429 · 503 · 연결 실패).
 * 받으면 사라진다. 개발 토큰으로 띄운 개발 서버에서는 보이지 않는다.
 */
export default function ServerNotice() {
  const status = useGuestStatus()
  const detail = status ? GUEST_NOTICE[status] : undefined
  if (!detail) return null
  return (
    <section className="notice cloud-s" role="status">
      <b>지금은 서버에 연결할 수 없습니다</b>
      <span>{detail}</span>
    </section>
  )
}
