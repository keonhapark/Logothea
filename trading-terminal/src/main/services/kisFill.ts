// 체결 판정은 KIS 호출과 분리한 순수 함수로 둔다 — 핸들러 테스트가 KisService 를 통째로 모킹해도 실제 규칙을 쓴다.

/** 체결 조회 한 건의 결과. */
export interface KisFill {
  executedQty: number
  avgPrice: number | null
  remainingQty: number | null
}

/**
 * 주문이 다 체결됐는지. 부분 체결을 완료로 보면 그 뒤의 체결이 기록에 반영되지 않는다
 * (예: MSFT 15주 주문이 3주 → 12주로 나눠 체결됐는데 거래 내역에 3주로 남았다).
 * 미체결 수량이 0 이면 완료로 본다 — 남은 수량이 취소된 경우도 여기서 끝난다. 미체결 수량을 모르면 주문 수량과 비교한다.
 */
export function isFillComplete(fill: KisFill, orderQty: number | null | undefined): boolean {
  if (fill.executedQty <= 0) return false
  if (fill.remainingQty != null) return fill.remainingQty === 0
  if (orderQty != null) return fill.executedQty >= orderQty
  // 둘 다 모르면 예전처럼 체결된 것으로 본다. 끝내 PENDING 으로 남겨 TTL 만료시키는 것보다 낫다.
  return true
}
