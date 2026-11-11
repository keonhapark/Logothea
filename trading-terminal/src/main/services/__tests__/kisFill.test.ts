import { describe, it, expect } from 'vitest'
import { isFillComplete } from '../kisFill'

describe('isFillComplete', () => {
  it('부분 체결(미체결 수량 남음)은 완료가 아니다', () => {
    expect(isFillComplete({ executedQty: 3, avgPrice: 520.71, remainingQty: 12 }, 15)).toBe(false)
  })

  it('미체결 수량이 0 이면 완료다', () => {
    expect(isFillComplete({ executedQty: 15, avgPrice: 520.67, remainingQty: 0 }, 15)).toBe(true)
  })

  it('남은 수량이 취소돼 미체결 0 이면 일부만 체결돼도 완료다', () => {
    expect(isFillComplete({ executedQty: 3, avgPrice: 520.71, remainingQty: 0 }, 15)).toBe(true)
  })

  it('미체결 수량을 모르면 주문 수량과 비교한다', () => {
    expect(isFillComplete({ executedQty: 3, avgPrice: 1, remainingQty: null }, 5)).toBe(false)
    expect(isFillComplete({ executedQty: 5, avgPrice: 1, remainingQty: null }, 5)).toBe(true)
  })

  it('체결 수량이 0 이면 완료가 아니다', () => {
    expect(isFillComplete({ executedQty: 0, avgPrice: null, remainingQty: 0 }, 5)).toBe(false)
  })

  it('미체결 수량도 주문 수량도 모르면 체결된 것으로 본다', () => {
    expect(isFillComplete({ executedQty: 2, avgPrice: 1, remainingQty: null }, null)).toBe(true)
  })
})
