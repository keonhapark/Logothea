package com.earningwhisperer.domain.stock;

public record StockPriceSnapshot(
        String ticker,
        double currentPrice,
        double previousClose,
        double changePercent,
        long updatedAt
) {
    /**
     * 현재가와 전일종가로 스냅샷을 만든다. 전일종가가 0 이하면 변동률은 0 이다.
     */
    public static StockPriceSnapshot of(String ticker, double currentPrice, double previousClose, long now) {
        return new StockPriceSnapshot(ticker, currentPrice, previousClose,
                changePercent(currentPrice, previousClose), now);
    }

    private static double changePercent(double price, double previousClose) {
        return previousClose > 0 ? (price - previousClose) / previousClose * 100.0 : 0.0;
    }

    /**
     * 전일종가만 갈아 끼우고 현재가는 유지한다.
     *
     * <p>일봉이 새로 적재되면 전일종가가 바뀐다. 그때 현재가까지 덮어쓰면 실시간 시세가
     * 사라지므로 변동률만 다시 계산한다.
     */
    public StockPriceSnapshot withPreviousClose(double newPreviousClose, long now) {
        return of(ticker, currentPrice, newPreviousClose, now);
    }

    public StockPriceSnapshot withPrice(double newPrice, long now) {
        return of(ticker, newPrice, previousClose, now);
    }
}
