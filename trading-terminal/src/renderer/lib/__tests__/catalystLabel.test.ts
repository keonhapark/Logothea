import { describe, expect, it } from 'vitest'
import { catalystLabel } from '../catalystLabel'

describe('catalystLabel', () => {
  it('아는 코드는 표에서 옮긴다. 대소문자와 공백 표기를 가리지 않는다', () => {
    expect(catalystLabel('EARNINGS_GUIDANCE_UPGRADE')).toBe('가이던스 상향')
    expect(catalystLabel('guidance_up')).toBe('가이던스 상향')
    expect(catalystLabel('Earnings Guidance Upgrade')).toBe('가이던스 상향')
  })

  it('표에 없는 코드는 단어마다 옮겨 잇는다', () => {
    expect(catalystLabel('Earnings Guidance Disappointment')).toBe('실적 가이던스 실망')
  })

  it('옮기지 못하는 단어가 있으면 원값을 그대로 둔다', () => {
    expect(catalystLabel('Tariff Refund Windfall')).toBe('Tariff Refund Windfall')
  })
})
