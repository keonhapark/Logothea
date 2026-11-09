package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.infrastructure.finnhub.dto.FinnhubQuote;
import com.earningwhisperer.infrastructure.websocket.StockPriceCache;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
@DisplayName("QuoteRefreshScheduler 상위 종목 시세 채움")
class QuoteRefreshSchedulerTest {

    @Mock private FinnhubClient finnhubClient;
    @Mock private StockRepository stockRepository;
    @Mock private StockPriceCache priceCache;
    @Mock private FinnhubWebSocketManager webSocketManager;

    private static final FinnhubQuote QUOTE = new FinnhubQuote(105.0, 5.0, 5.0, 100.0, 1L);

    private QuoteRefreshScheduler schedulerAt(String instant) {
        return new QuoteRefreshScheduler(finnhubClient, stockRepository, priceCache, webSocketManager,
                Clock.fixed(Instant.parse(instant), ZoneOffset.UTC));
    }

    private static Set<String> tickers(int fromInclusive, int toInclusive) {
        return IntStream.rangeClosed(fromInclusive, toInclusive).mapToObj(i -> "T" + i).collect(Collectors.toSet());
    }

    /** 시가총액 순으로 정렬된 n 개 종목 T1..Tn. */
    private void givenRankedStocks(int n) {
        List<Object[]> rows = IntStream.rangeClosed(1, n)
                .mapToObj(i -> new Object[]{Stock.builder().ticker("T" + i).companyName("C").sector("S").build(), null})
                .toList();
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(rows);
    }

    @Test
    @DisplayName("전체 갱신은 상위 100개까지만 부르고 시세를 캐시에 반영한다")
    void 전체_갱신_상위_100() {
        givenRankedStocks(120);
        given(finnhubClient.fetchQuote(anyString(), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(true);

        int applied = schedulerAt("2026-11-10T21:10:00Z").refresh("close", Set.of());

        assertThat(applied).isEqualTo(100);
        verify(finnhubClient).fetchQuote("T1", FinnhubRateLimiter.Priority.LOW);
        verify(finnhubClient).fetchQuote("T100", FinnhubRateLimiter.Priority.LOW);
        verify(finnhubClient, never()).fetchQuote(eq("T101"), any());
        verify(priceCache).applyQuote("T1", 105.0, 100.0, true); // 16:10 ET — 장 마감 뒤
        verify(priceCache).retainQuoteTickers(IntStream.rangeClosed(1, 100).mapToObj(i -> "T" + i).toList());
    }

    @Test
    @DisplayName("장중 갱신은 WS 가 실제로 구독한 종목만 빼고 상위 100 을 부른다")
    void 장중_갱신_WS_구독_종목_제외() {
        givenRankedStocks(120);
        // 기동 때 1~50위를 구독했는데 이후 순위가 바뀌어 T52 가 지금 1~50위 안에 있다고 가정해도
        // 기준은 구독 집합이다. 여기서는 T1~T49 와 T52 를 구독 중으로 둔다.
        Set<String> subscribed = new java.util.HashSet<>(tickers(1, 49));
        subscribed.add("T52");
        given(webSocketManager.subscribedTickers()).willReturn(subscribed);
        given(finnhubClient.fetchQuote(anyString(), any())).willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(true);

        // 2026-11-10 15:00 UTC = 10:00 ET
        int applied = schedulerAt("2026-11-10T15:00:00Z").refresh("intraday", webSocketManager.subscribedTickers());

        assertThat(applied).isEqualTo(50);
        verify(finnhubClient).fetchQuote("T50", FinnhubRateLimiter.Priority.LOW);
        verify(finnhubClient, never()).fetchQuote(eq("T52"), any());
        verify(finnhubClient, never()).fetchQuote(eq("T1"), any());
        verify(finnhubClient).fetchQuote("T100", FinnhubRateLimiter.Priority.LOW);
    }

    @Test
    @DisplayName("장중 창 안이면 WS 구독 집합을 빼고 부른다")
    void 장중_창_안_실행() {
        givenRankedStocks(2);
        given(webSocketManager.subscribedTickers()).willReturn(Set.of("T1"));
        given(finnhubClient.fetchQuote(anyString(), any())).willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(true);

        schedulerAt("2026-11-10T15:00:00Z").refreshIntraday();

        verify(finnhubClient, never()).fetchQuote(eq("T1"), any());
        verify(finnhubClient).fetchQuote("T2", FinnhubRateLimiter.Priority.LOW);
    }

    @Test
    @DisplayName("장중 창은 미국 동부 09:35 이상 16:00 미만이다")
    void 장중_창_판정() {
        // 11-10 은 서머타임이 끝나 ET = UTC-5
        assertThat(schedulerAt("2026-11-10T14:34:00Z").isIntradayWindow()).isFalse(); // 09:34
        assertThat(schedulerAt("2026-11-10T14:35:00Z").isIntradayWindow()).isTrue();  // 09:35
        assertThat(schedulerAt("2026-11-10T20:55:00Z").isIntradayWindow()).isTrue();  // 15:55
        assertThat(schedulerAt("2026-11-10T21:00:00Z").isIntradayWindow()).isFalse(); // 16:00
        // 서머타임 중(ET = UTC-4): 2026-07-01 13:35 UTC = 09:35 ET
        assertThat(schedulerAt("2026-07-01T13:35:00Z").isIntradayWindow()).isTrue();
    }

    @Test
    @DisplayName("장중 창 밖이면 아무것도 부르지 않는다")
    void 장중_창_밖_무시() {
        schedulerAt("2026-11-10T14:30:00Z").refreshIntraday(); // 09:30 ET

        verifyNoInteractions(finnhubClient, stockRepository, webSocketManager);
    }

    @Test
    @DisplayName("응답이 없거나 가격이 0 인 종목은 캐시에 반영하지 않는다")
    void 빈_응답_무시() {
        givenRankedStocks(3);
        given(finnhubClient.fetchQuote(eq("T1"), any())).willReturn(Optional.empty());
        given(finnhubClient.fetchQuote(eq("T2"), any()))
                .willReturn(Optional.of(new FinnhubQuote(0, null, null, 0, 0)));
        given(finnhubClient.fetchQuote(eq("T3"), any())).willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote("T3", 105.0, 100.0, true)).willReturn(true);

        int applied = schedulerAt("2026-11-10T21:10:00Z").refresh("close", Set.of());

        assertThat(applied).isEqualTo(1);
        verify(priceCache, times(1)).applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean());
        verify(priceCache).applyQuote("T3", 105.0, 100.0, true);
    }

    @Test
    @DisplayName("이전 실행이 돌고 있으면 겹쳐 실행하지 않는다")
    void 겹침_실행_방지() {
        givenRankedStocks(1);
        QuoteRefreshScheduler scheduler = schedulerAt("2026-11-10T21:10:00Z");
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(true);
        int[] nested = new int[1];
        given(finnhubClient.fetchQuote(anyString(), any())).willAnswer(inv -> {
            nested[0] = scheduler.refresh("nested", Set.of());
            return Optional.of(QUOTE);
        });

        int applied = scheduler.refresh("close", Set.of());

        assertThat(nested[0]).isEqualTo(-1);
        assertThat(applied).isEqualTo(1);
        // 끝나면 다시 돌 수 있다
        assertThat(scheduler.refresh("again", Set.of())).isEqualTo(1);
    }

    @Test
    @DisplayName("캐시가 반영하지 않은 종목은 반영 건수에 세지 않는다")
    void 캐시_미반영은_세지_않음() {
        givenRankedStocks(1);
        given(finnhubClient.fetchQuote(anyString(), any())).willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(false);

        assertThat(schedulerAt("2026-11-10T21:10:00Z").refresh("startup", Set.of())).isZero();
    }

    @Test
    @DisplayName("정규장 판정: 평일 09:30 이상 16:00 미만만 장중이다")
    void 정규장_판정() {
        assertThat(schedulerAt("2026-11-10T14:29:00Z").isRegularSession()).isFalse(); // 화 09:29
        assertThat(schedulerAt("2026-11-10T14:30:00Z").isRegularSession()).isTrue();  // 화 09:30
        assertThat(schedulerAt("2026-11-10T21:00:00Z").isRegularSession()).isFalse(); // 화 16:00
        assertThat(schedulerAt("2026-11-07T16:00:00Z").isRegularSession()).isFalse(); // 토 11:00
    }

    @Test
    @DisplayName("장중 시세는 종가로 기록하지 않고, 부분 갱신은 시세 종목 목록을 줄이지 않는다")
    void 장중_시세() {
        givenRankedStocks(2);
        given(finnhubClient.fetchQuote(anyString(), any())).willReturn(Optional.of(QUOTE));
        given(priceCache.applyQuote(anyString(), anyDouble(), anyDouble(), anyBoolean())).willReturn(true);

        schedulerAt("2026-11-10T15:00:00Z").refresh("intraday", Set.of("T1"));

        verify(priceCache).applyQuote("T2", 105.0, 100.0, false);
        verify(priceCache, never()).retainQuoteTickers(any());
    }
}
