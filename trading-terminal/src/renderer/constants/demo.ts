/**
 * 기본 시연 종목. 백엔드 기본 시연 스크립트(backend/src/main/resources/data/demo-earnings-call.json)의
 * `ticker` 와 같아야 한다. 스크립트 종목을 바꾸면 이 값도 함께 바꾼다.
 *
 * 전시용 웹의 반복 방송 종목(`BROADCAST_TICKER`)이 이 값을 쓴다.
 */
export const DEMO_TICKER = 'WMT'

/**
 * 시연 대본이 있는 종목. 기본 종목과 백엔드 종목별 대본(backend/src/main/resources/data/demo/<종목>.json)이다.
 * 대본을 더하거나 빼면 이 목록도 함께 바꾼다.
 *
 * 시연 재생 버튼과 발화자 명부는 이 종목들의 콜 화면에만 보인다. 대본이 없는 종목에서 재생하면 기본 종목의
 * 문장이 그 종목 이름으로 나가기 때문이다.
 */
export const DEMO_TICKERS: readonly string[] = [DEMO_TICKER, 'NVDA']

export function isDemoTicker(ticker: string | null | undefined): boolean {
  return ticker != null && DEMO_TICKERS.includes(ticker)
}
