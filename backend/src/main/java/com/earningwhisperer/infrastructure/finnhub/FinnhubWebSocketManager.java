package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.infrastructure.websocket.StockPriceCache;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
@ConditionalOnExpression("!'${finnhub.api-key:}'.isBlank()")
public class FinnhubWebSocketManager {

    private static final int SYMBOLS_PER_KEY = 50;

    private final FinnhubProperties properties;
    private final StockPriceCache priceCache;
    private final StockRepository stockRepository;
    private final ObjectMapper objectMapper;

    /** 기동 시 구독을 맡긴 종목. 순위가 바뀌어도 재기동 전까지 그대로다. */
    private volatile Set<String> subscribedTickers = Set.of();

    @Async
    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        List<String> activeKeys = properties.activeWsKeys();
        if (activeKeys.isEmpty()) {
            log.info("[FinnhubWS] ws-keys 미설정 — 실시간 가격 구독 비활성화");
            return;
        }

        List<String> topTickers = loadTopTickers(activeKeys.size() * SYMBOLS_PER_KEY);
        if (topTickers.isEmpty()) {
            log.warn("[FinnhubWS] 활성 종목 없음 — 구독 중단");
            return;
        }

        // 키 수 × 50 개로 잘라 왔으므로 전부 어느 키엔가 배정된다.
        subscribedTickers = Set.copyOf(topTickers);

        for (int i = 0; i < activeKeys.size(); i++) {
            int from = i * SYMBOLS_PER_KEY;
            if (from >= topTickers.size()) break;

            int to = Math.min(from + SYMBOLS_PER_KEY, topTickers.size());
            List<String> slice = topTickers.subList(from, to);
            String label = (i + 1) + "/" + activeKeys.size();

            Thread thread = new Thread(
                    new FinnhubWebSocketClient(activeKeys.get(i), slice, priceCache, objectMapper, label),
                    "finnhub-ws-" + (i + 1)
            );
            thread.setDaemon(true);
            thread.start();

            log.info("[FinnhubWS] 키 {} — {}~{}위 {}개 종목 구독 스레드 시작",
                    label, from + 1, to, slice.size());
        }
    }

    /**
     * 실시간 구독을 맡긴 종목. {@link QuoteRefreshScheduler} 가 장중 REST 갱신에서 이 종목들을 뺀다.
     * 연결이 끊겨 재연결 중인 상태도 구독으로 센다.
     */
    public Set<String> subscribedTickers() {
        return subscribedTickers;
    }

    private List<String> loadTopTickers(int limit) {
        return stockRepository.findAllActiveWithMetaSorted()
                .stream()
                .map(row -> ((Stock) row[0]).getTicker())
                .limit(limit)
                .toList();
    }
}
