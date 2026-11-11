package com.earningwhisperer.infrastructure.websocket;

import com.earningwhisperer.domain.stock.DailyBarRepository;
import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockPriceSnapshot;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.domain.stock.TickerLatestClose;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;

/**
 * 기동 시 현재가 · 전일종가 적재, REST 시세 반영, 거래일 넘김.
 *
 * <p>시장 지도는 상위 100개의 일일 변동률이 있어야 한다. 예전에는 장 마감 뒤 당일 봉이
 * 적재되면 전일종가가 당일 종가가 되어 0% 가 됐고, 일봉이 없는 종목은 전일종가가 0 이라
 * 늘 0% 였다.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("StockPriceCache 기동 적재 · 시세 반영 · 거래일 넘김")
class StockPriceCacheQuoteTest {

    @Mock private StockRepository stockRepository;
    @Mock private DailyBarRepository dailyBarRepository;

    @InjectMocks private StockPriceCache cache;

    private static final LocalDate TODAY = LocalDate.parse("2026-11-10");

    private static Stock stockOf(String ticker) {
        return Stock.builder().ticker(ticker).companyName("Co").sector("Information Technology").build();
    }

    private StockPriceSnapshot snapshotOf(String ticker) {
        return cache.getAllAsMap().get(ticker);
    }

    /** 2026-11-10 22:00 UTC = 17:00 ET (장 마감 뒤). */
    private void fixClockAfterClose() {
        cache.setClock(Clock.fixed(Instant.parse("2026-11-10T22:00:00Z"), ZoneOffset.UTC));
    }

    /** 일봉 없이 전일종가 0 으로 적재된 상태를 만든다. */
    private void initializeWithoutBars(String... tickers) {
        given(stockRepository.findByActiveTrue())
                .willReturn(Arrays.stream(tickers).map(StockPriceCacheQuoteTest::stockOf).toList());
        given(dailyBarRepository.findLatestClosesInRange(any(), any(), any())).willReturn(List.of());
        cache.initialize();
    }

    @Test
    @DisplayName("장 마감 뒤 재기동: 현재가는 당일 종가, 전일종가는 그 전 봉이라 당일 변동률이 남는다")
    void 마감_후_재기동_변동률_유지() {
        fixClockAfterClose();
        given(stockRepository.findByActiveTrue()).willReturn(List.of(stockOf("AAPL")));
        // 현재가: 오늘까지 포함한 기간
        given(dailyBarRepository.findLatestClosesInRange(any(), eq(TODAY.minusDays(7)), eq(TODAY.plusDays(1))))
                .willReturn(List.of(new TickerLatestClose("AAPL", 110.0)));
        // 전일종가: 오늘을 뺀 기간
        given(dailyBarRepository.findLatestClosesInRange(any(), eq(TODAY.minusDays(7)), eq(TODAY)))
                .willReturn(List.of(new TickerLatestClose("AAPL", 100.0)));

        cache.initialize();

        StockPriceSnapshot snap = snapshotOf("AAPL");
        assertThat(snap.currentPrice()).isEqualTo(110.0);
        assertThat(snap.previousClose()).isEqualTo(100.0);
        assertThat(snap.changePercent()).isCloseTo(10.0, within(1e-9));
    }

    @Test
    @DisplayName("오늘 기준일은 미국 동부 날짜다 — UTC 로 이미 다음 날이어도 동부가 전날이면 전날로 본다")
    void 기준일은_미국_동부() {
        // 2026-11-11 03:00 UTC = 2026-11-10 22:00 ET
        cache.setClock(Clock.fixed(Instant.parse("2026-11-11T03:00:00Z"), ZoneOffset.UTC));
        given(stockRepository.findByActiveTrue()).willReturn(List.of(stockOf("AAPL")));
        given(dailyBarRepository.findLatestClosesInRange(any(), any(), any())).willReturn(List.of());
        given(dailyBarRepository.findLatestClosesInRange(any(), any(), eq(TODAY)))
                .willReturn(List.of(new TickerLatestClose("AAPL", 100.0)));

        cache.initialize();

        assertThat(snapshotOf("AAPL").previousClose()).isEqualTo(100.0);
    }

    @Test
    @DisplayName("일봉이 없던 종목도 시세를 반영하면 0 이 아닌 실제 전일종가와 변동률을 갖는다")
    void 시세_반영_전일종가_채움() {
        initializeWithoutBars("NVDA");
        assertThat(snapshotOf("NVDA").previousClose()).isZero();

        assertThat(cache.applyQuote("NVDA", 105.0, 100.0, false)).isTrue();

        StockPriceSnapshot snap = snapshotOf("NVDA");
        assertThat(snap.currentPrice()).isEqualTo(105.0);
        assertThat(snap.previousClose()).isEqualTo(100.0);
        assertThat(snap.changePercent()).isCloseTo(5.0, within(1e-9));
        // /prices 와 STOMP 발행 경로로 나간다
        assertThat(cache.getDirtyAndClear()).extracting(StockPriceSnapshot::ticker).containsExactly("NVDA");
        assertThat(cache.getAll()).extracting(StockPriceSnapshot::previousClose).containsExactly(100.0);
    }

    @Test
    @DisplayName("시세 반영 뒤 실시간 체결이 오면 새 전일종가 기준으로 변동률을 계산한다")
    void 시세_반영_후_실시간_체결() {
        initializeWithoutBars("NVDA");
        cache.applyQuote("NVDA", 105.0, 100.0, false);

        cache.update("NVDA", 98.0);

        assertThat(snapshotOf("NVDA").changePercent()).isCloseTo(-2.0, within(1e-9));
    }

    @Test
    @DisplayName("응답의 전일종가가 0 이면 기존 전일종가를 유지한다")
    void 전일종가_0_이면_유지() {
        initializeWithoutBars("NVDA");
        cache.applyQuote("NVDA", 105.0, 100.0, false);

        cache.applyQuote("NVDA", 110.0, 0.0, false);

        StockPriceSnapshot snap = snapshotOf("NVDA");
        assertThat(snap.currentPrice()).isEqualTo(110.0);
        assertThat(snap.previousClose()).isEqualTo(100.0);
    }

    @Test
    @DisplayName("현재가가 0 이하이거나 캐시에 없는 종목이면 무시하고 false 를 돌려준다")
    void 비정상_시세_무시() {
        initializeWithoutBars("NVDA");
        cache.getDirtyAndClear();

        assertThat(cache.applyQuote("NVDA", 0.0, 100.0, false)).isFalse();
        assertThat(cache.applyQuote("UNKNOWN", 50.0, 40.0, false)).isFalse();

        assertThat(snapshotOf("NVDA").previousClose()).isZero();
        assertThat(cache.getAllAsMap()).doesNotContainKey("UNKNOWN");
        assertThat(cache.getDirtyAndClear()).isEmpty();
    }

    @Test
    @DisplayName("시세로 받은 전일종가는 일봉 재적재가 덮지 않는다 — 갱신이 멈춘 옛 봉으로 바뀌지 않는다")
    void 시세_전일종가는_일봉이_덮지_않음() {
        initializeWithoutBars("NVDA", "WMT");
        cache.applyQuote("NVDA", 105.0, 100.0, false);
        given(dailyBarRepository.findLatestClosesInRange(anyCollection(), any(), any()))
                .willReturn(List.of(new TickerLatestClose("WMT", 90.0)));

        cache.refreshPreviousCloses();

        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(100.0);
        assertThat(snapshotOf("WMT").previousClose()).isEqualTo(90.0);
        // 일봉 조회 대상에서도 빠진다
        org.mockito.Mockito.verify(dailyBarRepository).findLatestClosesInRange(
                argThat(c -> c.contains("WMT") && !c.contains("NVDA")), any(), any());
    }

    @Test
    @DisplayName("거래일 넘김: 시세 종목은 장 마감 뒤 받아 둔 종가가 전일종가가 되고, 일봉 종목은 일봉을 다시 읽는다")
    void 거래일_넘김() {
        initializeWithoutBars("NVDA", "WMT");
        cache.applyQuote("NVDA", 105.0, 100.0, true); // 전날 16:10 시세 — 종가 105
        cache.update("NVDA", 108.15);                  // 애프터마켓 체결
        given(dailyBarRepository.findLatestClosesInRange(anyCollection(), any(), any()))
                .willReturn(List.of(new TickerLatestClose("WMT", 90.0)));
        cache.getDirtyAndClear();

        cache.rollPreviousClosesBeforeOpen();

        // 시간외 체결가가 아니라 받아 둔 종가가 전일종가가 된다
        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(105.0);
        assertThat(snapshotOf("WMT").previousClose()).isEqualTo(90.0);
        assertThat(cache.getDirtyAndClear()).extracting(StockPriceSnapshot::ticker)
                .containsExactlyInAnyOrder("NVDA", "WMT");

        // 장이 열리면 새 전일종가 기준으로 계산한다
        cache.update("NVDA", 107.1);
        assertThat(snapshotOf("NVDA").changePercent()).isCloseTo(2.0, within(1e-9));
    }

    @Test
    @DisplayName("거래일 넘김: 받아 둔 종가가 없으면 시세 종목의 전일종가를 건드리지 않는다")
    void 거래일_넘김_종가_없음() {
        initializeWithoutBars("NVDA");
        cache.applyQuote("NVDA", 105.0, 100.0, false); // 장중 시세만 있음
        cache.update("NVDA", 108.15);

        cache.rollPreviousClosesBeforeOpen();

        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(100.0);
    }

    @Test
    @DisplayName("받아 둔 종가는 한 번만 넘긴다 — 다음 날 종가를 못 받으면 이틀 전 종가를 다시 쓰지 않는다")
    void 받아_둔_종가는_한_번만() {
        initializeWithoutBars("NVDA");
        cache.applyQuote("NVDA", 105.0, 100.0, true);
        cache.rollPreviousClosesBeforeOpen();
        cache.applyQuote("NVDA", 110.0, 105.0, false); // 다음 날 장중

        cache.rollPreviousClosesBeforeOpen();           // 그날 16:10 시세를 못 받음

        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(105.0);
    }

    @Test
    @DisplayName("상위에서 밀려난 시세 종목은 일봉 종목으로 돌아가 일봉이 없으면 전일종가가 0(모름)이 된다")
    void 밀려난_시세_종목() {
        initializeWithoutBars("NVDA", "OLD");
        cache.applyQuote("NVDA", 105.0, 100.0, true);
        cache.applyQuote("OLD", 50.0, 40.0, true);

        cache.retainQuoteTickers(List.of("NVDA"));
        cache.rollPreviousClosesBeforeOpen();

        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(105.0);
        assertThat(snapshotOf("OLD").previousClose()).isZero();
    }

    @Test
    @DisplayName("장중 시세가 들어오면 롤오버 뒤에 기록된 종가를 지운다 — 다음 날까지 묵지 않는다")
    void 장중_시세가_기록_종가를_지움() {
        initializeWithoutBars("NVDA");
        cache.applyQuote("NVDA", 105.0, 100.0, true);  // 09:10 기동 — 롤오버 뒤에 기록됨
        cache.applyQuote("NVDA", 106.0, 104.5, false); // 09:31 장중 시세 — 전일종가 104.5

        cache.rollPreviousClosesBeforeOpen();           // 다음 날 09:00, 그날 16:10 은 실패

        // 묵은 105.0 으로 넘기지 않고 그대로 둔 채 09:31 시세를 기다린다
        assertThat(snapshotOf("NVDA").previousClose()).isEqualTo(104.5);
    }

    @Test
    @DisplayName("실시간 체결을 받은 종목만 '최근 체결' 로 본다 — REST 시세는 체결로 치지 않는다")
    void 최근_체결_종목() {
        initializeWithoutBars("MSFT", "AAPL", "NVDA");
        cache.update("MSFT", 520.0);
        cache.applyQuote("AAPL", 355.0, 350.0, false);

        assertThat(cache.recentlyTicked(List.of("MSFT", "AAPL", "NVDA"), java.time.Duration.ofMinutes(10)))
                .containsExactly("MSFT");
        assertThat(cache.recentlyTicked(List.of("MSFT"), java.time.Duration.ZERO.minusMillis(1))).isEmpty();
    }
}
