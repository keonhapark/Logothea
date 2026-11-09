export interface Sp500Stock {
  ticker: string
  companyName: string
  sector: string | null
  marketCapUsd: number | null
  /** 시가총액이 있는 종목 중 1부터 매긴 순위. 시가총액이 없으면 null. 옛 서버는 보내지 않는다. */
  marketCapRank?: number | null
  currentPrice: number | null
  /** 전일 종가. 모르면 null. 옛 서버는 보내지 않는다. */
  previousClose?: number | null
  changePercent: number | null
}

export interface StockPriceEntry {
  ticker: string
  currentPrice: number
  previousClose: number
  changePercent: number
  updatedAt: number
}
