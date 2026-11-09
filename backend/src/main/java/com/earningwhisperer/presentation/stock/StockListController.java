package com.earningwhisperer.presentation.stock;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockMeta;
import com.earningwhisperer.domain.stock.StockPriceSnapshot;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.infrastructure.websocket.StockPriceCache;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * S&P 500 종목 리스트 엔드포인트.
 * GET /api/v1/stocks/sp500 — JWT 불필요 (Market Screen 초기 로딩용)
 */
@RestController
@RequestMapping("/api/v1/stocks")
@RequiredArgsConstructor
public class StockListController {

    private final StockRepository stockRepository;
    private final StockPriceCache priceCache;

    @GetMapping("/sp500")
    public ResponseEntity<List<StockSummaryDto>> getSp500() {
        Map<String, StockPriceSnapshot> prices = priceCache.getAllAsMap();

        // 시가총액 내림차순으로 정렬되어 오므로 시가총액이 있는 줄을 만날 때마다 순위를 하나씩 올린다.
        List<StockSummaryDto> result = new ArrayList<>();
        int rank = 0;
        for (Object[] row : stockRepository.findAllActiveWithMetaSorted()) {
            Stock s = (Stock) row[0];
            StockMeta sm = row[1] != null ? (StockMeta) row[1] : null;

            Double marketCap = sm != null && sm.getMarketCapUsd() != null && sm.getMarketCapUsd().signum() > 0
                    ? sm.getMarketCapUsd().doubleValue()
                    : null;
            Integer marketCapRank = marketCap != null ? ++rank : null;

            StockPriceSnapshot snap = prices.get(s.getTicker());
            Double currentPrice = snap != null && snap.currentPrice() > 0 ? snap.currentPrice() : null;
            Double previousClose = snap != null && snap.previousClose() > 0 ? snap.previousClose() : null;
            Double changePercent = currentPrice != null && previousClose != null ? snap.changePercent() : null;

            result.add(new StockSummaryDto(
                    s.getTicker(),
                    s.getCompanyName(),
                    s.getSector(),
                    marketCap,
                    marketCapRank,
                    currentPrice,
                    previousClose,
                    changePercent
            ));
        }

        return ResponseEntity.ok(result);
    }
}
