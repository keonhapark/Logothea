package com.earningwhisperer.domain.earnings;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.config.JpaConfig;
import com.earningwhisperer.infrastructure.stock.StockDataInitializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.annotation.AnnotationAwareOrderComparator;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** Real H2 persistence and the checked-in correction file; no FMP client or external service. */
@DataJpaTest(properties = {"fmp.api-key=", "earnings-calendar.demo-overrides.enabled=true"})
@Import({JpaConfig.class, EarningsCalendarService.class, EarningsCalendarOverrides.class,
        EarningsCalendarStartup.class, EarningsCalendarCorrectionIntegrationTest.JsonConfig.class})
class EarningsCalendarCorrectionIntegrationTest {

    @Autowired private EarningsCalendarService service;
    @Autowired private EarningsCalendarStartup startup;
    @Autowired private EarningsCalendarRepository calendar;
    @Autowired private StockRepository stocks;
    @Autowired private EntityManager entityManager;

    private record ExpectedCall(String ticker, String utc, String kst, String session) {}

    private static final List<ExpectedCall> VERIFIED_CALLS = List.of(
            new ExpectedCall("CSCO", "2026-11-12T21:30:00Z", "2026-11-13 06:30", "amc"),
            new ExpectedCall("DIS", "2026-11-17T13:30:00Z", "2026-11-17 22:30", "bmo"),
            new ExpectedCall("NVDA", "2026-11-17T22:00:00Z", "2026-11-18 07:00", "amc"),
            new ExpectedCall("TGT", "2026-11-18T13:00:00Z", "2026-11-18 22:00", "bmo"),
            new ExpectedCall("WMT", "2026-11-19T13:00:00Z", "2026-11-19 22:00", "bmo"),
            new ExpectedCall("ADBE", "2026-12-09T22:00:00Z", "2026-12-10 07:00", "amc"),
            new ExpectedCall("WFC", "2027-01-14T15:00:00Z", "2027-01-15 00:00", "dmh"),
            new ExpectedCall("C", "2027-01-14T16:00:00Z", "2027-01-15 01:00", "dmh"),
            new ExpectedCall("BAC", "2027-01-15T13:30:00Z", "2027-01-15 22:30", "bmo"));

    @Test
    void orderedStartupSeedsStocksBeforeCorrectingAllNineCallsInAnEmptyDatabase() throws Exception {
        assertThat(stocks.count()).isZero();
        assertThat(calendar.count()).isZero();
        var stockInitializer = new StockDataInitializer(stocks);
        // Deliberately reverse registration order; use the same comparator as Spring Boot runners.
        var runners = new ArrayList<ApplicationRunner>(List.of(startup, stockInitializer));
        AnnotationAwareOrderComparator.sort(runners);
        assertThat(runners).containsExactly(stockInitializer, startup);

        var args = new DefaultApplicationArguments(new String[0]);
        for (var runner : runners) {
            runner.run(args);
        }
        flushAndClear();

        assertThat(stocks.count()).isGreaterThan(9);
        assertThat(calendar.count()).isEqualTo(9);
        for (var call : VERIFIED_CALLS) {
            assertThat(onlyRow(call.ticker()).getScheduledAt()).isEqualTo(Instant.parse(call.utc()));
        }
    }

    @Test
    void startupWithoutFmpKeyCreatesNineOfficialUtcTimesWithCorrectKoreanDates() {
        VERIFIED_CALLS.forEach(call -> stock(call.ticker()));

        startup.run(new DefaultApplicationArguments(new String[0]));
        flushAndClear();

        assertThat(calendar.count()).isEqualTo(9);
        var kstFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Seoul"));
        for (var call : VERIFIED_CALLS) {
            var row = onlyRow(call.ticker());
            assertThat(row.getScheduledAt()).as(call.ticker()).isEqualTo(Instant.parse(call.utc()));
            assertThat(kstFormat.format(row.getScheduledAt())).as(call.ticker() + " KST").isEqualTo(call.kst());
            assertThat(row.isConfirmed()).isTrue();
            assertThat(row.getMarketSession()).isEqualTo(call.session());
        }
    }

    @Test
    void canonicalRowSurvivesAndMissingEstimateComesFromNewestAlias() {
        var dis = stock("DIS");
        var official = seed(dis, "2026-11-17T13:30:00Z", "1.2500", null);
        Long officialId = official.getId();
        seed(dis, "2026-11-12T00:00:00Z", "8.0000", "100.00");
        seed(dis, "2026-11-17T00:00:00Z", "9.0000", "200.00");

        service.applyVerifiedOverrides();
        flushAndClear();

        var corrected = onlyRow("DIS");
        assertThat(corrected.getId()).isEqualTo(officialId);
        assertThat(corrected.getScheduledAt()).isEqualTo(Instant.parse("2026-11-17T13:30:00Z"));
        assertThat(corrected.getEpsEstimate()).isEqualByComparingTo("1.2500");
        assertThat(corrected.getRevenueEstimate()).isEqualByComparingTo("200.00");
        assertThat(corrected.isConfirmed()).isTrue();
        assertThat(corrected.getMarketSession()).isEqualTo("bmo");
    }

    @Test
    void newestAliasSurvivesEvenWhenItWasInsertedFirstAndMissingEstimatesArePreserved() {
        var nvda = stock("NVDA");
        Long newestId = seed(nvda, "2026-11-18T00:00:00Z", null, "200.00").getId();
        seed(nvda, "2026-11-17T00:00:00Z", "1.8000", null);

        service.applyVerifiedOverrides();
        flushAndClear();

        var corrected = onlyRow("NVDA");
        assertThat(corrected.getId()).isEqualTo(newestId);
        assertThat(corrected.getScheduledAt()).isEqualTo(Instant.parse("2026-11-17T22:00:00Z"));
        assertThat(corrected.getEpsEstimate()).isEqualByComparingTo("1.8000");
        assertThat(corrected.getRevenueEstimate()).isEqualByComparingTo("200.00");
    }

    @Test
    void repeatedStartupPreservesIdsCountsAndValues() {
        var nvda = stock("NVDA");
        seed(nvda, "2026-11-17T00:00:00Z", "2.0000", "300.00");
        seed(nvda, "2026-11-18T00:00:00Z", null, null);
        stock("CSCO");
        service.applyVerifiedOverrides();
        flushAndClear();
        Map<Long, RowSnapshot> firstRun = snapshot();

        service.applyVerifiedOverrides();
        flushAndClear();

        assertThat(snapshot()).isEqualTo(firstRun);
    }

    @Test
    void leavesOtherQuartersUnlistedSameDayTimesAndUnverifiedCompaniesUntouched() {
        var nvda = stock("NVDA");
        seed(nvda, "2026-08-26T21:00:00Z", "1.0000", "100.00");
        seed(nvda, "2027-02-17T00:00:00Z", "2.0000", "200.00");
        seed(nvda, "2026-11-17T01:00:00Z", "3.0000", "300.00");
        seed(stock("COST"), "2026-12-10T00:00:00Z", "4.0000", "400.00");
        seed(stock("NKE"), "2026-12-17T00:00:00Z", "5.0000", "500.00");
        flushAndClear();
        Map<Long, RowSnapshot> untouched = snapshot();

        service.applyVerifiedOverrides();
        flushAndClear();

        assertThat(snapshot()).containsAllEntriesOf(untouched).hasSize(untouched.size() + 1);
        assertThat(calendar.findByStockTickerAndScheduledAt("NVDA", Instant.parse("2026-11-17T22:00:00Z"))).isPresent();
    }

    @Test
    void repeatedFmpAliasesDoNotRecreateMidnightRowsOrEraseExistingEstimates() {
        var nvda = stock("NVDA");
        seed(nvda, "2026-11-17T00:00:00Z", "2.0000", "300.00");
        service.applyVerifiedOverrides();
        flushAndClear();
        Long correctedId = onlyRow("NVDA").getId();

        service.upsert("NVDA", Instant.parse("2026-11-17T00:00:00Z"), false, null, null, null);
        service.upsert("NVDA", Instant.parse("2026-11-18T00:00:00Z"), false, "bmo", null, null);
        flushAndClear();

        var corrected = onlyRow("NVDA");
        assertThat(corrected.getId()).isEqualTo(correctedId);
        assertThat(corrected.getScheduledAt()).isEqualTo(Instant.parse("2026-11-17T22:00:00Z"));
        assertThat(corrected.getEpsEstimate()).isEqualByComparingTo("2.0000");
        assertThat(corrected.getRevenueEstimate()).isEqualByComparingTo("300.00");
        assertThat(corrected.isConfirmed()).isTrue();
        assertThat(corrected.getMarketSession()).isEqualTo("amc");
    }

    @Test
    void fmpCanRefreshNonNullEstimatesAtCanonicalTimeWithoutLosingTheOtherEstimate() {
        var nvda = stock("NVDA");
        Long officialId = seed(nvda, "2026-11-17T22:00:00Z", "2.0000", "300.00").getId();

        service.upsert("NVDA", Instant.parse("2026-11-18T00:00:00Z"), false, null, new BigDecimal("2.5000"), null);
        service.upsert("NVDA", Instant.parse("2026-11-17T22:00:00Z"), false, null, null, new BigDecimal("350.00"));
        flushAndClear();

        var corrected = onlyRow("NVDA");
        assertThat(corrected.getId()).isEqualTo(officialId);
        assertThat(corrected.getEpsEstimate()).isEqualByComparingTo("2.5000");
        assertThat(corrected.getRevenueEstimate()).isEqualByComparingTo("350.00");
        assertThat(corrected.isConfirmed()).isTrue();
        assertThat(corrected.getMarketSession()).isEqualTo("amc");
    }

    @Test
    void fmpStillAcceptsOtherQuartersAndUnverifiedCompaniesWithoutRewritingTheirTimes() {
        stock("NVDA");
        stock("COST");

        service.upsert("NVDA", Instant.parse("2027-02-17T00:00:00Z"), false, null, new BigDecimal("3.0000"), null);
        service.upsert("COST", Instant.parse("2026-12-10T00:00:00Z"), false, null, null, new BigDecimal("500.00"));
        flushAndClear();

        assertThat(calendar.count()).isEqualTo(2);
        assertThat(onlyRow("NVDA").getScheduledAt()).isEqualTo(Instant.parse("2027-02-17T00:00:00Z"));
        assertThat(onlyRow("COST").getScheduledAt()).isEqualTo(Instant.parse("2026-12-10T00:00:00Z"));
        assertThat(onlyRow("COST").isConfirmed()).isFalse();
    }

    @Test
    void skipsMissingStocksAndAppliesOnLaterRunAfterStockIsCreated() {
        service.applyVerifiedOverrides();
        service.upsert("NVDA", Instant.parse("2026-11-17T00:00:00Z"), true, null, null, null);
        flushAndClear();
        assertThat(calendar.count()).isZero();
        assertThat(stocks.count()).isZero();

        stock("NVDA");
        service.applyVerifiedOverrides();
        flushAndClear();

        assertThat(calendar.count()).isEqualTo(1);
        assertThat(stocks.count()).isEqualTo(1);
        assertThat(onlyRow("NVDA").getScheduledAt()).isEqualTo(Instant.parse("2026-11-17T22:00:00Z"));
    }

    private Stock stock(String ticker) {
        return stocks.saveAndFlush(Stock.builder().ticker(ticker).companyName(ticker).sector("TEST").build());
    }

    private EarningsCalendar seed(Stock stock, String at, String eps, String revenue) {
        return calendar.saveAndFlush(EarningsCalendar.builder().stock(stock).scheduledAt(Instant.parse(at))
                .confirmed(false).marketSession(null)
                .epsEstimate(eps == null ? null : new BigDecimal(eps))
                .revenueEstimate(revenue == null ? null : new BigDecimal(revenue)).build());
    }

    private EarningsCalendar onlyRow(String ticker) {
        var rows = calendar.findAll().stream().filter(row -> row.getStock().getTicker().equals(ticker)).toList();
        assertThat(rows).as("calendar rows for " + ticker).hasSize(1);
        return rows.get(0);
    }

    private record RowSnapshot(String ticker, Instant at, boolean confirmed, String session,
                               BigDecimal eps, BigDecimal revenue) {
        static RowSnapshot from(EarningsCalendar row) {
            return new RowSnapshot(row.getStock().getTicker(), row.getScheduledAt(), row.isConfirmed(),
                    row.getMarketSession(), row.getEpsEstimate(), row.getRevenueEstimate());
        }
    }

    private Map<Long, RowSnapshot> snapshot() {
        return calendar.findAll().stream().collect(Collectors.toMap(EarningsCalendar::getId, RowSnapshot::from));
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JsonConfig {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().registerModule(new JavaTimeModule());
        }
    }
}
