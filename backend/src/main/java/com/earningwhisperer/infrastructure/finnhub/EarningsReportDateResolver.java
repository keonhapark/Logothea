package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.global.common.SyncPriority;
import com.earningwhisperer.infrastructure.fmp.FmpClient;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 실적 결과 한 건(Finnhub period · EPS)의 실제 발표일을 찾는다.
 *
 * <p>Finnhub `/stock/earnings` 의 period 는 발표일이 아니라 분기 말일이고, 회계 분기가 달력과 어긋난 회사는
 * 달력 분기 말로 맞춰 오기도 한다(예: WMT 의 7월 말 분기가 period 2026-09-30, 실제 발표는 2026-08-20).
 * period 를 발표일로 쓰면 "최근 어닝 반응" 이 엉뚱한 날짜의 주가로 계산된다.
 *
 * <p>발표일 출처는 FMP `/stable/earnings` 이고, 무료 등급 밖 종목은 공식 IR 에서 확인한
 * {@code data/earnings-report-dates.json} 으로 보충한다.
 */
@Component
@Slf4j
public class EarningsReportDateResolver {

    static final String FALLBACK_RESOURCE = "data/earnings-report-dates.json";
    /** period 앞뒤로 찾을 범위. 회계 분기와 달력 분기의 차이(최대 두 달)와 발표 지연(최대 석 달)을 덮는다. */
    static final long BEFORE_PERIOD_DAYS = 75;
    static final long AFTER_PERIOD_DAYS = 120;
    /** 같은 분기로 볼 EPS 차이. 공급사마다 반올림이 달라 소수 둘째 자리 차이는 같은 값으로 본다. */
    static final BigDecimal EPS_TOLERANCE = new BigDecimal("0.02");

    /** 발표일과 그날의 EPS 실제값. */
    public record Report(LocalDate date, BigDecimal epsActual) {}

    private final ObjectProvider<FmpClient> fmpClient;
    private final Map<String, List<Report>> fallback;

    public EarningsReportDateResolver(ObjectProvider<FmpClient> fmpClient, ObjectMapper objectMapper) {
        this.fmpClient = fmpClient;
        this.fallback = loadFallback(objectMapper);
    }

    /** 종목의 발표 이력. FMP 를 먼저 쓰고, 비면 보충 파일을 쓴다. */
    public List<Report> reports(String ticker, SyncPriority priority) {
        List<Report> result = new ArrayList<>();
        FmpClient client = fmpClient.getIfAvailable();
        if (client != null) {
            client.fetchEarningsReports(ticker, priority.toFmp()).forEach(r -> {
                LocalDate date = parse(r.date());
                if (date != null && r.epsActual() != null) {
                    result.add(new Report(date, r.epsActual()));
                }
            });
        }
        if (result.isEmpty()) {
            result.addAll(fallback.getOrDefault(ticker, List.of()));
        }
        return result;
    }

    /** 가장 가까운 발표와 거리 차이가 이 안이면 EPS 가 같은 쪽을 고른다. */
    static final long TIE_WINDOW_DAYS = 10;

    /**
     * period · EPS 실제값에 맞는 발표일. 이미 다른 분기에 쓴 발표일({@code used})은 제외하고, period 에 가장 가까운
     * 발표를 고른다. 거리가 비슷한 후보가 여럿이면 EPS 가 같은 쪽을 고른다. 범위 안에 후보가 없으면 비운다 —
     * period 를 발표일로 대신 쓰지 않는다.
     */
    static Optional<LocalDate> match(LocalDate period, BigDecimal epsActual, List<Report> reports, Set<LocalDate> used) {
        if (period == null || reports == null || reports.isEmpty()) {
            return Optional.empty();
        }
        LocalDate from = period.minusDays(BEFORE_PERIOD_DAYS);
        LocalDate to = period.plusDays(AFTER_PERIOD_DAYS);
        Comparator<Report> byDistance = Comparator.comparingLong(r -> distance(period, r));
        List<Report> candidates = reports.stream()
                .filter(r -> !r.date().isBefore(from) && !r.date().isAfter(to))
                .filter(r -> used == null || !used.contains(r.date()))
                .sorted(byDistance)
                .toList();
        if (candidates.isEmpty()) {
            return Optional.empty();
        }
        long nearest = distance(period, candidates.get(0));
        Optional<Report> sameEps = epsActual == null ? Optional.empty() : candidates.stream()
                .filter(r -> distance(period, r) <= nearest + TIE_WINDOW_DAYS)
                .filter(r -> r.epsActual() != null
                        && r.epsActual().subtract(epsActual).abs().compareTo(EPS_TOLERANCE) <= 0)
                .findFirst();
        return Optional.of(sameEps.orElse(candidates.get(0)).date());
    }

    static Optional<LocalDate> match(LocalDate period, BigDecimal epsActual, List<Report> reports) {
        return match(period, epsActual, reports, Set.of());
    }

    private static long distance(LocalDate period, Report r) {
        return Math.abs(ChronoUnit.DAYS.between(period, r.date()));
    }

    private static LocalDate parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value.trim().substring(0, 10));
        } catch (RuntimeException e) {
            return null;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record FallbackDocument(Map<String, List<FallbackEntry>> tickers) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record FallbackEntry(String date, BigDecimal epsActual, String sourceUrl) {}

    private static Map<String, List<Report>> loadFallback(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource(FALLBACK_RESOURCE);
        if (!resource.exists()) {
            return Map.of();
        }
        try (InputStream in = resource.getInputStream()) {
            FallbackDocument doc = objectMapper.readValue(in, FallbackDocument.class);
            if (doc.tickers() == null) {
                return Map.of();
            }
            Map<String, List<Report>> result = new java.util.HashMap<>();
            doc.tickers().forEach((ticker, entries) -> result.put(ticker, entries.stream()
                    .filter(e -> parse(e.date()) != null)
                    .map(e -> new Report(parse(e.date()), e.epsActual()))
                    .toList()));
            return Map.copyOf(result);
        } catch (IOException e) {
            // 보충 파일이 깨졌다고 기동을 막지는 않는다. FMP 로 찾을 수 있는 종목은 그대로 동작한다.
            log.error("[EarningsReportDate] {} 를 읽지 못했습니다 — 보충 없이 동작합니다", FALLBACK_RESOURCE, e);
            return Map.of();
        }
    }
}
