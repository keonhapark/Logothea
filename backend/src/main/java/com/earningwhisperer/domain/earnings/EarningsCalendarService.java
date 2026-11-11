package com.earningwhisperer.domain.earnings;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

@Service
@RequiredArgsConstructor
@Slf4j
public class EarningsCalendarService {

    private final EarningsCalendarRepository earningsCalendarRepository;
    private final StockRepository stockRepository;
    private final EarningsCalendarOverrides verifiedOverrides;

    @Transactional(readOnly = true)
    public List<EarningsCalendar> getUpcomingByTickers(List<String> tickers) {
        if (tickers == null || tickers.isEmpty()) {
            return List.of();
        }
        return earningsCalendarRepository.findUpcomingByTickers(tickers, Instant.now());
    }

    @Transactional(readOnly = true)
    public List<EarningsCalendar> getCalendar(int daysAhead) {
        Instant from = Instant.now();
        Instant to = from.plus(daysAhead, ChronoUnit.DAYS);
        return earningsCalendarRepository.findByScheduledAtBetween(from, to);
    }

    /**
     * Finnhub 스케줄러에서 호출. 수신한 어닝콜 데이터를 upsert 처리.
     *
     * <p>Phase 2-B 에서 컨센서스(epsEstimate / revenueEstimate) 영속화를 위해 시그니처 확장.
     * 호출자: FmpEarningsScheduler (FMP /stable/earnings-calendar 응답 upsert).
     * estimate 는 nullable — Finnhub 응답에 필드 없으면 null 그대로 영속화한다.
     */
    @Transactional
    public void upsert(String ticker,
                       Instant scheduledAt,
                       boolean confirmed,
                       String marketSession,
                       BigDecimal epsEstimate,
                       BigDecimal revenueEstimate) {
        var correction = verifiedOverrides.find(ticker, scheduledAt);
        if (correction.isPresent()) {
            // Lock the stock, not just calendar rows: two writers may both see no calendar row yet.
            stockRepository.findByTickerForCalendarUpdate(ticker)
                    .ifPresent(stock -> mergeVerifiedEvent(stock, correction.get(), epsEstimate, revenueEstimate));
            return;
        }
        Stock stock = stockRepository.findByTicker(ticker).orElse(null);
        if (stock == null) return;

        earningsCalendarRepository.findByStockTickerAndScheduledAt(ticker, scheduledAt)
                .ifPresentOrElse(
                        existing -> existing.updateAll(scheduledAt, confirmed, marketSession, epsEstimate, revenueEstimate),
                        () -> earningsCalendarRepository.save(
                                EarningsCalendar.builder()
                                        .stock(stock)
                                        .scheduledAt(scheduledAt)
                                        .confirmed(confirmed)
                                        .marketSession(marketSession)
                                        .epsEstimate(epsEstimate)
                                        .revenueEstimate(revenueEstimate)
                                        .build())
                );
    }

    /** Apply the checked-in, event-specific demo corrections without calling an external API. */
    @Transactional
    public void applyVerifiedOverrides() {
        var entries = verifiedOverrides.entries().stream()
                .sorted(Comparator.comparing(EarningsCalendarOverrides.Entry::ticker)).toList();
        int available = 0;
        for (var entry : entries) {
            var stock = stockRepository.findByTickerForCalendarUpdate(entry.ticker());
            if (stock.isEmpty()) {
                log.warn("[EarningsCalendarCorrection] skipped ticker={} reason=stock_missing", entry.ticker());
                continue;
            }
            mergeVerifiedEvent(stock.get(), entry, null, null);
            available++;
        }
        log.info("[EarningsCalendarCorrection] checked={} available={} missing={}",
                entries.size(), available, entries.size() - available);
    }

    private void mergeVerifiedEvent(Stock stock, EarningsCalendarOverrides.Entry entry,
                                    BigDecimal incomingEps, BigDecimal incomingRevenue) {
        var times = new ArrayList<>(entry.replaces());
        times.add(entry.scheduledAt());
        var rows = new ArrayList<>(earningsCalendarRepository.findByStock_IdAndScheduledAtIn(stock.getId(), times));
        rows.sort(Comparator.comparing(EarningsCalendar::getScheduledAt).reversed()
                .thenComparing(EarningsCalendar::getId));
        var survivor = rows.stream().filter(row -> row.getScheduledAt().equals(entry.scheduledAt()))
                .findFirst().orElse(rows.isEmpty() ? null : rows.get(0));

        BigDecimal eps = incomingEps != null ? incomingEps
                : survivor != null && survivor.getEpsEstimate() != null ? survivor.getEpsEstimate()
                : rows.stream().map(EarningsCalendar::getEpsEstimate).filter(Objects::nonNull).findFirst().orElse(null);
        BigDecimal revenue = incomingRevenue != null ? incomingRevenue
                : survivor != null && survivor.getRevenueEstimate() != null ? survivor.getRevenueEstimate()
                : rows.stream().map(EarningsCalendar::getRevenueEstimate).filter(Objects::nonNull).findFirst().orElse(null);

        if (survivor == null) {
            earningsCalendarRepository.save(EarningsCalendar.builder().stock(stock)
                    .scheduledAt(entry.scheduledAt()).confirmed(entry.isConfirmed()).marketSession(entry.marketSession())
                    .epsEstimate(eps).revenueEstimate(revenue).build());
            log.info("[EarningsCalendarCorrection] created ticker={} utc={}", entry.ticker(), entry.scheduledAt());
            return;
        }

        var kept = survivor;
        var duplicates = rows.stream().filter(row -> !row.getId().equals(kept.getId())).toList();
        if (!duplicates.isEmpty()) {
            earningsCalendarRepository.deleteAll(duplicates);
            // Hibernate may otherwise update scheduled_at before deleting a conflicting unique key.
            earningsCalendarRepository.flush();
        }
        Instant previous = survivor.getScheduledAt();
        survivor.updateAll(entry.scheduledAt(), entry.isConfirmed(), entry.marketSession(), eps, revenue);
        if (!previous.equals(entry.scheduledAt()) || !duplicates.isEmpty()) {
            log.info("[EarningsCalendarCorrection] corrected ticker={} keptId={} from={} to={} removed={}",
                    entry.ticker(), survivor.getId(), previous, entry.scheduledAt(),
                    duplicates.stream().map(row -> row.getId() + "@" + row.getScheduledAt()).toList());
        }
    }
}
