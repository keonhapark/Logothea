package com.earningwhisperer.domain.stock;

import com.earningwhisperer.global.config.JpaConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@Import(JpaConfig.class)
@DisplayName("DailyBarRepository 슬라이스 테스트")
class DailyBarRepositoryTest {

    @Autowired private DailyBarRepository dailyBarRepository;
    @Autowired private StockRepository stockRepository;

    /** 아래 기본 테스트들의 봉(2026-04-29 ~ 04-30)을 모두 포함하는 기간. */
    private static final LocalDate FROM = LocalDate.parse("2026-04-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-01");

    @Test
    @DisplayName("findLatestClosesInRange - 각 ticker 의 가장 최근 close 반환")
    void findLatestClosesInRange_각_ticker_가장_최근_close() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        Stock tsla = stockRepository.save(Stock.builder().ticker("TSLA").companyName("Tesla").sector("AUTO").build());

        // NVDA: 두 개 — 최신 close=150
        dailyBarRepository.save(DailyBar.builder()
                .stock(nvda).barDate(LocalDate.parse("2026-04-29"))
                .closePrice(new BigDecimal("140.00")).volume(1L).build());
        dailyBarRepository.save(DailyBar.builder()
                .stock(nvda).barDate(LocalDate.parse("2026-04-30"))
                .closePrice(new BigDecimal("150.00")).volume(2L).build());
        // TSLA: 하나만 — close=220
        dailyBarRepository.save(DailyBar.builder()
                .stock(tsla).barDate(LocalDate.parse("2026-04-30"))
                .closePrice(new BigDecimal("220.00")).volume(3L).build());

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(Set.of("NVDA", "TSLA"), FROM, TO);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(TickerLatestClose::ticker)
                .containsExactlyInAnyOrder("NVDA", "TSLA");
        assertThat(result.stream().filter(t -> t.ticker().equals("NVDA")).findFirst())
                .hasValueSatisfying(t -> assertThat(t.close()).isEqualTo(150.00));
        assertThat(result.stream().filter(t -> t.ticker().equals("TSLA")).findFirst())
                .hasValueSatisfying(t -> assertThat(t.close()).isEqualTo(220.00));
    }

    @Test
    @DisplayName("findLatestClosesInRange - daily_bar 없는 ticker 는 결과에서 제외")
    void findLatestClosesInRange_daily_bar_없으면_제외() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        stockRepository.save(Stock.builder().ticker("AAPL").companyName("Apple").sector("TECH").build());

        // NVDA 만 daily_bar 존재
        dailyBarRepository.save(DailyBar.builder()
                .stock(nvda).barDate(LocalDate.parse("2026-04-30"))
                .closePrice(new BigDecimal("150.00")).volume(1L).build());

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(Set.of("NVDA", "AAPL"), FROM, TO);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).ticker()).isEqualTo("NVDA");
    }

    @Test
    @DisplayName("findLatestClosesInRange - stocks 테이블에 없는 ticker 는 결과에서 제외")
    void findLatestClosesInRange_stock_미존재_제외() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        dailyBarRepository.save(DailyBar.builder()
                .stock(nvda).barDate(LocalDate.parse("2026-04-30"))
                .closePrice(new BigDecimal("150.00")).volume(1L).build());

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(Set.of("NVDA", "UNKNOWN"), FROM, TO);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).ticker()).isEqualTo("NVDA");
    }

    @Test
    @DisplayName("findLatestClosesInRange - 빈 입력은 빈 결과")
    void findLatestClosesInRange_빈_입력_빈_결과() {
        // 일부 DB 는 IN () 빈 절을 지원하지 않으나 호출 측이 항상 비어있지 않은 set 을 보내는 계약 가정 —
        // 그래도 회귀 보호를 위해 단일 ticker 여도 동작하는지 확인.
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        dailyBarRepository.save(DailyBar.builder()
                .stock(nvda).barDate(LocalDate.parse("2026-04-30"))
                .closePrice(new BigDecimal("150.00")).volume(1L).build());

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(Set.of("NVDA"), FROM, TO);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).close()).isEqualTo(150.0);
    }

    @Test
    @DisplayName("findLatestClosesInRange - 상한(배타) 당일 봉은 빼고 기간 안 마지막 close 를 반환")
    void findLatestClosesInRange_당일_봉_제외() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        Stock tsla = stockRepository.save(Stock.builder().ticker("TSLA").companyName("Tesla").sector("AUTO").build());

        saveBar(nvda, "2026-11-06", "140.00");
        saveBar(nvda, "2026-11-09", "145.00");
        saveBar(nvda, "2026-11-10", "150.00");
        // TSLA 는 당일 봉만 있다 — 전일종가 없음
        saveBar(tsla, "2026-11-10", "220.00");

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(
                Set.of("NVDA", "TSLA"), LocalDate.parse("2026-11-03"), LocalDate.parse("2026-11-10"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).ticker()).isEqualTo("NVDA");
        assertThat(result.get(0).close()).isEqualTo(145.00);
    }

    @Test
    @DisplayName("findLatestClosesInRange - 하한보다 오래된 봉만 있으면 결과에서 빠진다")
    void findLatestClosesInRange_오래된_봉_제외() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        saveBar(nvda, "2026-07-10", "100.00");

        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(
                Set.of("NVDA"), LocalDate.parse("2026-11-03"), LocalDate.parse("2026-11-10"));

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("findLatestClosesInRange - 주말 · 휴장일을 건너뛰어 기간 안 마지막 거래일 봉을 쓴다")
    void findLatestClosesInRange_주말_건너뜀() {
        Stock nvda = stockRepository.save(Stock.builder().ticker("NVDA").companyName("NVIDIA").sector("TECH").build());
        saveBar(nvda, "2026-11-06", "140.00"); // 금요일

        // 월요일 기준 전일종가
        List<TickerLatestClose> result = dailyBarRepository.findLatestClosesInRange(
                Set.of("NVDA"), LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-09"));

        assertThat(result).extracting(TickerLatestClose::close).containsExactly(140.00);
    }

    private void saveBar(Stock stock, String date, String close) {
        dailyBarRepository.save(DailyBar.builder()
                .stock(stock).barDate(LocalDate.parse(date))
                .closePrice(new BigDecimal(close)).volume(1L).build());
    }
}
