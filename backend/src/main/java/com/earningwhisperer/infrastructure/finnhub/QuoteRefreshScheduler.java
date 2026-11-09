package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.infrastructure.finnhub.dto.FinnhubQuote;
import com.earningwhisperer.infrastructure.websocket.StockPriceCache;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 시가총액 상위 종목의 현재가 · 전일종가를 Finnhub {@code /quote} 로 채운다.
 *
 * <p><b>왜 필요한가.</b> 실시간 체결(WS)은 키당 50종목만 구독한다. 그 밖의 종목은 현재가가
 * 바뀌지 않고, 일봉이 없는 종목은 전일종가도 0 이라 변동률이 늘 0% 였다. WS 로 구독하는
 * 종목도 일봉이 없으면 전일종가가 0 이라 같은 문제가 있었다. 시장 지도는 상위 100개의 일일
 * 변동률이 있어야 하므로 REST 시세로 빈자리를 채운다.
 *
 * <p><b>호출 시점</b> (미국 동부, 월~금)
 * <ul>
 *     <li>기동 직후: 상위 100 전부</li>
 *     <li>09:31: 상위 100 전부 — 거래일이 바뀐 뒤 전일종가를 새 값으로 맞춘다</li>
 *     <li>09:35~15:55, 5분마다: WS 가 구독하지 않는 종목만. 구독은 기동 시점 순위로 고정되므로
 *         지금 순위가 아니라 실제로 구독을 맡긴 종목을 뺀다</li>
 *     <li>16:10: 상위 100 전부 — 당일 종가와 전일종가를 확정한다</li>
 * </ul>
 *
 * <p><b>호출량.</b> {@link FinnhubRateLimiter} 를 LOW 우선순위로 공유한다(분당 30회 안전선).
 * WS 키가 하나면 5분마다 50회(분당 약 10회), WS 키가 없으면 100회(분당 약 20회)라 시장
 * 지수(분당 5회)와 합쳐도 한도 안이다. 전체 100회는 0.5 req/s 로 약 200초 걸린다.
 *
 * <p>평일 휴장일에도 돈다. 시세는 직전 거래일 값으로 맞게 나오고 호출만 낭비된다.
 *
 * <p>스케줄 메서드는 {@code @Async} 로 돌린다. 기본 스케줄러 스레드는 하나뿐이라, 수 분짜리
 * 루프가 붙잡으면 1초 주기 시세 발행({@code StockPricePublisher})까지 멈춘다.
 */
@Slf4j
@Component
@ConditionalOnExpression("!'${finnhub.api-key:}'.isBlank()")
public class QuoteRefreshScheduler {

    /** 시세를 채우는 상위 순위 수. 시장 지도가 보여 주는 범위와 같다. */
    static final int TOP_N = 100;

    private static final ZoneId MARKET_ZONE = ZoneId.of("America/New_York");
    private static final LocalTime MARKET_OPEN = LocalTime.of(9, 30);
    private static final LocalTime INTRADAY_START = LocalTime.of(9, 35);
    private static final LocalTime MARKET_CLOSE = LocalTime.of(16, 0);

    private final FinnhubClient finnhubClient;
    private final StockRepository stockRepository;
    private final StockPriceCache priceCache;
    private final FinnhubWebSocketManager webSocketManager;
    private final Clock clock;

    /** 실행이 겹치면 같은 종목을 두 번 부르게 되므로 하나만 돌린다. */
    private final AtomicBoolean running = new AtomicBoolean(false);

    @Autowired
    public QuoteRefreshScheduler(FinnhubClient finnhubClient,
                                 StockRepository stockRepository,
                                 StockPriceCache priceCache,
                                 FinnhubWebSocketManager webSocketManager) {
        this(finnhubClient, stockRepository, priceCache, webSocketManager, Clock.systemUTC());
    }

    QuoteRefreshScheduler(FinnhubClient finnhubClient,
                          StockRepository stockRepository,
                          StockPriceCache priceCache,
                          FinnhubWebSocketManager webSocketManager,
                          Clock clock) {
        this.finnhubClient = finnhubClient;
        this.stockRepository = stockRepository;
        this.priceCache = priceCache;
        this.webSocketManager = webSocketManager;
        this.clock = clock;
    }

    @Async
    @EventListener(ApplicationReadyEvent.class)
    public void refreshOnStartup() {
        refresh("startup", Set.of());
    }

    @Async
    @Scheduled(cron = "0 31 9 * * MON-FRI", zone = "America/New_York")
    public void refreshAtOpen() {
        refresh("open", Set.of());
    }

    @Async
    @Scheduled(cron = "0 */5 9-15 * * MON-FRI", zone = "America/New_York")
    public void refreshIntraday() {
        if (!isIntradayWindow()) return;
        refresh("intraday", webSocketManager.subscribedTickers());
    }

    @Async
    @Scheduled(cron = "0 10 16 * * MON-FRI", zone = "America/New_York")
    public void refreshAfterClose() {
        refresh("close", Set.of());
    }

    /**
     * 평일 09:30 ≤ 지금 < 16:00 (미국 동부). 이 밖에서 받은 시세의 현재가는 직전 거래일 종가다.
     * 휴장일은 구분하지 않는다.
     */
    boolean isRegularSession() {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(MARKET_ZONE));
        DayOfWeek day = now.getDayOfWeek();
        if (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY) return false;
        LocalTime time = now.toLocalTime();
        return !time.isBefore(MARKET_OPEN) && time.isBefore(MARKET_CLOSE);
    }

    /** 09:35 ≤ 지금 < 16:00 (미국 동부). 09:31 전체 갱신과 겹치지 않게 09:35 부터 돈다. */
    boolean isIntradayWindow() {
        LocalTime now = LocalTime.now(clock.withZone(MARKET_ZONE));
        return !now.isBefore(INTRADAY_START) && now.isBefore(MARKET_CLOSE);
    }

    /**
     * @param exclude 상위 {@link #TOP_N} 가운데 부르지 않을 종목(WS 구독 종목).
     * @return 시세를 반영한 종목 수. 다른 실행이 돌고 있으면 -1.
     */
    int refresh(String trigger, Set<String> exclude) {
        if (!running.compareAndSet(false, true)) {
            log.info("[QuoteRefresh] {} — 이전 실행이 진행 중이라 건너뜁니다", trigger);
            return -1;
        }
        try {
            List<String> tickers = stockRepository.findAllActiveWithMetaSorted()
                    .stream()
                    .map(row -> ((Stock) row[0]).getTicker())
                    .limit(TOP_N)
                    .toList();
            if (exclude.isEmpty()) {
                // 전체 갱신 — 상위에서 밀려난 종목은 시세 종목에서 뺀다
                priceCache.retainQuoteTickers(tickers);
            } else {
                tickers = tickers.stream().filter(t -> !exclude.contains(t)).toList();
            }
            if (tickers.isEmpty()) return 0;

            int applied = 0;
            for (String ticker : tickers) {
                Optional<FinnhubQuote> quote = finnhubClient.fetchQuote(ticker, FinnhubRateLimiter.Priority.LOW);
                if (quote.isEmpty() || !quote.get().hasPrice()) continue;
                // 전체 갱신은 200초쯤 걸려 정규장 경계를 넘을 수 있으므로 종목마다 판정한다.
                boolean sessionClosed = !isRegularSession();
                if (priceCache.applyQuote(ticker, quote.get().current(), quote.get().previousClose(), sessionClosed)) {
                    applied++;
                }
            }

            if (applied == 0) {
                log.warn("[QuoteRefresh] {} — {}개 종목 중 시세를 하나도 받지 못했습니다. Finnhub 키와 한도를 확인하세요.",
                        trigger, tickers.size());
            } else {
                log.info("[QuoteRefresh] {} — {}/{}개 종목 반영", trigger, applied, tickers.size());
            }
            return applied;
        } finally {
            running.set(false);
        }
    }
}
