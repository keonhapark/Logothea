package com.earningwhisperer.infrastructure.websocket;

import com.earningwhisperer.domain.stock.StockPriceSnapshot;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.domain.stock.DailyBarRepository;
import com.earningwhisperer.domain.stock.TickerLatestClose;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class StockPriceCache {

    /** 일봉 날짜와 "오늘"을 맞추는 기준 시간대. 일봉은 미국 동부 거래일 기준이다. */
    static final ZoneId MARKET_ZONE = ZoneId.of("America/New_York");

    /**
     * 현재가 · 전일종가로 인정하는 일봉의 최대 나이(일). 이보다 오래된 봉은 "모름"으로 본다.
     * 주말에 휴장일이 붙어도 거래일 간격은 4일을 넘지 않는다.
     */
    static final int BAR_LOOKBACK_DAYS = 7;

    private final StockRepository stockRepository;
    private final DailyBarRepository dailyBarRepository;

    /** 테스트에서 날짜를 고정하기 위해 바꿀 수 있다. */
    private Clock clock = Clock.systemUTC();

    private final ConcurrentHashMap<String, StockPriceSnapshot> cache = new ConcurrentHashMap<>();
    private final Set<String> dirtyTickers = ConcurrentHashMap.newKeySet();

    /**
     * REST 시세로 전일종가를 받은 종목. 이 종목들의 전일종가는 시세가 기준이라 일봉으로 덮지 않는다.
     * 일봉이 매일 갱신되지 않는 종목이면 일봉 쪽 값이 틀릴 수 있기 때문이다.
     */
    private final Set<String> quoteTickers = ConcurrentHashMap.newKeySet();

    /**
     * 정규장 밖에서 받은 시세의 현재가 = 직전 거래일 종가. 다음 거래일 09:00 에 전일종가로 넘기고
     * 지운다. 장중 시세가 들어와도 지운다 — 롤오버 뒤(09:00~09:30) 기록된 값이 다음 날까지 묵지
     * 않게 한다. 캐시의 현재가를 쓰지 않는 이유는 WS 가 시간외 체결도 넣기 때문이다.
     */
    private final ConcurrentHashMap<String, Double> quoteCloses = new ConcurrentHashMap<>();

    /** 실시간 체결({@link #update})을 마지막으로 받은 시각(epoch ms). REST 시세는 여기에 기록하지 않는다. */
    private final ConcurrentHashMap<String, Long> liveTickAt = new ConcurrentHashMap<>();

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /**
     * 기동 시 일봉으로 현재가와 전일종가를 채운다.
     *
     * <p>현재가는 가장 최근 봉 종가, 전일종가는 오늘(미국 동부) 이전 마지막 봉 종가다.
     * {@link #BAR_LOOKBACK_DAYS} 보다 오래된 봉은 쓰지 않는다 — 몇 달 전 변동률이 오늘 것처럼 보인다.
     * 장 마감 뒤 당일 봉이 이미 적재된 상태로 재기동하면 두 값이 달라 당일 변동률이 그대로
     * 살아난다. 예전에는 둘 다 가장 최근 봉을 써서 재기동 직후 전부 0% 였다.
     */
    @Order(Ordered.HIGHEST_PRECEDENCE)
    @EventListener(ApplicationReadyEvent.class)
    public void initialize() {
        List<String> tickers = stockRepository.findByActiveTrue()
                .stream().map(s -> s.getTicker()).toList();
        if (tickers.isEmpty()) return;

        LocalDate today = today();
        LocalDate from = today.minusDays(BAR_LOOKBACK_DAYS);
        Map<String, Double> lastCloseMap =
                toMap(dailyBarRepository.findLatestClosesInRange(tickers, from, today.plusDays(1)));
        Map<String, Double> prevCloseMap =
                toMap(dailyBarRepository.findLatestClosesInRange(tickers, from, today));

        long now = System.currentTimeMillis();
        for (String ticker : tickers) {
            double prev = prevCloseMap.getOrDefault(ticker, 0.0);
            double current = lastCloseMap.getOrDefault(ticker, prev);
            cache.put(ticker, StockPriceSnapshot.of(ticker, current, prev, now));
        }
        log.info("[StockPriceCache] 초기화 완료 — {}개 종목 (DailyBar 있음: {}개)",
                tickers.size(), lastCloseMap.size());
    }

    /**
     * 일봉이 새로 적재된 뒤 전일종가를 다시 읽어 온다.
     *
     * <p>전일종가는 기동 시 한 번만 채워졌기 때문에, 일봉을 동기화해도 앱을 재시작할
     * 때까지 옛 값이 남아 있었다. 그 값으로 변동률을 계산하면 화면에 없던 폭락이 뜬다 —
     * 실제로 WMT 가 4개월 전 종가(130.15)와 비교되어 -18.5% 로 표시됐다.
     *
     * <p>오늘(미국 동부) 이전 {@link #BAR_LOOKBACK_DAYS}일 안의 마지막 봉만 본다. 장 마감 뒤
     * 적재된 당일 봉을 전일종가로 쓰면 현재가와 같아져 변동률이 0% 가 된다. 기간 안에 봉이
     * 없으면 전일종가를 0(모름)으로 돌린다.
     *
     * <p>REST 시세로 전일종가를 받은 종목은 건너뛴다. 그 종목의 일봉은 매일 갱신된다는 보장이
     * 없어서, 덮으면 맞는 값을 틀린 값으로 바꾸게 된다.
     *
     * <p>현재가는 유지한다. 실시간 시세를 일봉 종가로 덮어쓰면 안 된다.
     *
     * @return 값이 실제로 바뀐 종목 수.
     */
    public int refreshPreviousCloses() {
        if (cache.isEmpty()) return 0;
        LocalDate today = today();
        List<String> tickers = cache.keySet().stream().filter(t -> !quoteTickers.contains(t)).toList();
        if (tickers.isEmpty()) return 0;
        Map<String, Double> closeMap = toMap(dailyBarRepository.findLatestClosesInRange(
                tickers, today.minusDays(BAR_LOOKBACK_DAYS), today));
        long now = System.currentTimeMillis();
        int changed = 0;
        for (String ticker : tickers) {
            // 기간 안에 봉이 없으면 전일종가를 모른다 — 오래된 값을 남기지 않고 0 으로 돌린다.
            // 봉은 있는데 종가가 0 이하면 잘못된 데이터라 기존 값을 지킨다.
            Double close = closeMap.get(ticker);
            if (close != null && close <= 0) continue;
            double prev = close != null ? close : 0.0;
            boolean[] updated = {false};
            cache.computeIfPresent(ticker, (t, existing) -> {
                // 목록을 뽑은 뒤 시세를 받아 시세 종목이 됐을 수 있다.
                if (quoteTickers.contains(t) || existing.previousClose() == prev) return existing;
                updated[0] = true;
                return existing.withPreviousClose(prev, now);
            });
            if (updated[0]) {
                dirtyTickers.add(ticker);
                changed++;
            }
        }
        if (changed > 0) {
            log.info("[StockPriceCache] 전일종가 갱신 — {}개 종목", changed);
        }
        return changed;
    }

    /**
     * 거래일이 바뀌면 전일종가를 하루 앞으로 넘긴다.
     *
     * <p>REST 시세 종목은 정규장 밖에서 받아 둔 종가(16:10 시세 등)를 전일종가로 넘긴다.
     * 받아 둔 종가가 없으면 그대로 두고 09:31 시세 갱신을 기다린다. 나머지 종목은 일봉을 다시
     * 읽는다. 정규장 시작(09:30) 전에 돌린다.
     */
    @Scheduled(cron = "0 0 9 * * MON-FRI", zone = "America/New_York")
    public void rollPreviousClosesBeforeOpen() {
        long now = System.currentTimeMillis();
        int rolled = 0;
        for (String ticker : quoteTickers) {
            Double close = quoteCloses.remove(ticker);
            if (close == null) continue;
            if (cache.computeIfPresent(ticker, (t, existing) -> existing.withPreviousClose(close, now)) != null) {
                dirtyTickers.add(ticker);
                rolled++;
            }
        }
        int refreshed = refreshPreviousCloses();
        log.info("[StockPriceCache] 거래일 넘김 — 시세 종목 {}개, 일봉 종목 {}개", rolled, refreshed);
    }

    /**
     * REST 시세(현재가 + 전일종가)를 반영한다.
     *
     * <p>일봉이 없는 종목은 전일종가가 0 이라 실시간 체결이 와도 변동률이 0% 로 남는다.
     * 시세 응답의 전일종가로 그 빈자리를 채운다. 응답의 전일종가가 0 이하면 기존 값을 유지한다.
     *
     * @param sessionClosed 정규장 밖에서 받은 시세면 true. 이때 현재가는 직전 거래일 종가라
     *                      다음 거래일 전일종가로 쓰려고 기록해 둔다.
     * @return 캐시에 반영했으면 true. 캐시에 없는 종목이거나 현재가가 0 이하면 false.
     */
    public boolean applyQuote(String ticker, double price, double previousClose, boolean sessionClosed) {
        if (price <= 0) return false;
        long now = System.currentTimeMillis();
        StockPriceSnapshot updated = cache.computeIfPresent(ticker, (t, existing) ->
                StockPriceSnapshot.of(t, price,
                        previousClose > 0 ? previousClose : existing.previousClose(), now));
        if (updated == null) return false;
        if (previousClose > 0) {
            quoteTickers.add(ticker);
        }
        if (sessionClosed) {
            quoteCloses.put(ticker, price);
        } else {
            quoteCloses.remove(ticker);
        }
        dirtyTickers.add(ticker);
        return true;
    }

    /**
     * 시세 종목을 {@code keep} 으로 좁힌다. 시가총액 상위에서 밀려 더 이상 시세를 받지 않는 종목은
     * 일봉 종목으로 돌아가 다음 {@link #refreshPreviousCloses()} 부터 일봉 기준(없으면 모름)이 된다.
     */
    public void retainQuoteTickers(Collection<String> keep) {
        Set<String> keepSet = Set.copyOf(keep);
        quoteTickers.retainAll(keepSet);
        quoteCloses.keySet().retainAll(keepSet);
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(MARKET_ZONE));
    }

    private static Map<String, Double> toMap(List<TickerLatestClose> closes) {
        return closes.stream()
                .collect(Collectors.toMap(
                        TickerLatestClose::ticker,
                        c -> c.close() != null ? c.close() : 0.0));
    }

    public void update(String ticker, double price) {
        // get 뒤 put 으로 나누면 그 사이 applyQuote 가 넣은 전일종가를 옛 값으로 되돌릴 수 있다.
        long now = System.currentTimeMillis();
        if (cache.computeIfPresent(ticker, (t, existing) -> existing.withPrice(price, now)) != null) {
            dirtyTickers.add(ticker);
            liveTickAt.put(ticker, now);
        }
    }

    /**
     * {@code tickers} 중 최근 {@code within} 안에 실시간 체결을 받은 종목.
     *
     * <p>웹소켓에 구독만 하고 체결이 오지 않는 종목(연결은 살아 있으나 무료 등급에서 체결이 끊기는 경우 등)을
     * REST 갱신에서 빼면 그 종목 시세가 장 시작 값에 멈춘다. 실제로 MSFT 가 하루 종일 장 시작 시세로 남았다.
     */
    public Set<String> recentlyTicked(Collection<String> tickers, java.time.Duration within) {
        long cutoff = System.currentTimeMillis() - within.toMillis();
        Set<String> result = new HashSet<>();
        for (String ticker : tickers) {
            Long at = liveTickAt.get(ticker);
            if (at != null && at >= cutoff) {
                result.add(ticker);
            }
        }
        return result;
    }

    public Collection<StockPriceSnapshot> getAll() {
        return Collections.unmodifiableCollection(cache.values());
    }

    public Map<String, StockPriceSnapshot> getAllAsMap() {
        return Collections.unmodifiableMap(cache);
    }

    public List<StockPriceSnapshot> getDirtyAndClear() {
        if (dirtyTickers.isEmpty()) return List.of();
        Set<String> snapshot = new HashSet<>(dirtyTickers);
        dirtyTickers.removeAll(snapshot);
        return snapshot.stream()
                .map(cache::get)
                .filter(Objects::nonNull)
                .toList();
    }
}
