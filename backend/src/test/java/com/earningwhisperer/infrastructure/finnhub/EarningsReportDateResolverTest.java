package com.earningwhisperer.infrastructure.finnhub;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("EarningsReportDateResolver.match")
class EarningsReportDateResolverTest {

    private static EarningsReportDateResolver.Report report(String date, String eps) {
        return new EarningsReportDateResolver.Report(LocalDate.parse(date), new BigDecimal(eps));
    }

    private static final List<EarningsReportDateResolver.Report> WMT = List.of(
            report("2026-08-20", "0.81"),
            report("2026-05-21", "0.66"),
            report("2026-02-19", "0.74"),
            report("2025-11-20", "0.62"));

    @Test
    @DisplayName("회계 분기가 달력과 어긋나 period 보다 먼저 발표한 분기도 EPS 로 맞춘다 (WMT period 09-30 → 08-20)")
    void periodBeforeReport() {
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-09-30"), new BigDecimal("0.81"), WMT))
                .contains(LocalDate.parse("2026-08-20"));
    }

    @Test
    @DisplayName("EPS 가 같은 발표가 없으면 period 에 가장 가까운 발표를 쓴다")
    void nearestWhenEpsDiffers() {
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-06-30"), new BigDecimal("9.99"), WMT))
                .contains(LocalDate.parse("2026-05-21"));
    }

    @Test
    @DisplayName("범위 안에 발표가 없으면 비운다")
    void emptyWhenOutOfRange() {
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2024-06-30"), new BigDecimal("0.81"), WMT))
                .isEmpty();
    }

    @Test
    @DisplayName("공급사 반올림 차이(0.01)는 같은 EPS 로 본다")
    void epsTolerance() {
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-03-31"), new BigDecimal("0.73"), WMT))
                .contains(LocalDate.parse("2026-02-19"));
    }

    @Test
    @DisplayName("FMP 가 없거나 비면 보충 파일의 발표일을 쓴다 (LLY)")
    void fallbackFileForPremiumTickers() {
        var resolver = new EarningsReportDateResolver(
                new org.springframework.beans.factory.support.StaticListableBeanFactory()
                        .getBeanProvider(com.earningwhisperer.infrastructure.fmp.FmpClient.class),
                new com.fasterxml.jackson.databind.ObjectMapper());

        var reports = resolver.reports("LLY", com.earningwhisperer.global.common.SyncPriority.LOW);

        assertThat(reports).extracting(EarningsReportDateResolver.Report::date)
                .contains(LocalDate.parse("2026-10-29"), LocalDate.parse("2026-02-04"));
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-09-30"), new BigDecimal("7.48"), reports))
                .contains(LocalDate.parse("2026-10-29"));
    }

    @Test
    @DisplayName("이미 다른 분기에 쓴 발표일은 다시 쓰지 않는다")
    void usedDatesAreExcluded() {
        var used = java.util.Set.of(LocalDate.parse("2026-08-20"));
        // 08-20 을 빼면 범위(07-17 ~ 2027-01-28) 안에 남는 발표가 없다 — 다른 분기 날짜를 빌려 쓰지 않는다.
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-09-30"), new BigDecimal("0.81"), WMT, used))
                .isEmpty();
    }

    @Test
    @DisplayName("거리가 확연히 먼 이웃 분기의 EPS 가 우연히 같아도 가까운 발표를 고른다 (MSFT)")
    void nearestBeatsDistantEpsMatch() {
        var msft = List.of(report("2026-10-28", "4.89"), report("2026-07-29", "4.74"));
        // period 2026-09-30, EPS 공급사 차이로 4.74 와 같다고 해도 07-29(-63일) 대신 10-28(+28일)
        assertThat(EarningsReportDateResolver.match(LocalDate.parse("2026-09-30"), new BigDecimal("4.74"), msft))
                .contains(LocalDate.parse("2026-10-28"));
    }
}
