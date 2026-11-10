package com.earningwhisperer.infrastructure.fmp;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockMeta;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.common.SyncPriority;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 시장 지도 · Market Screen 의 시가총액 표시를 위해 상위 {@value #TOP_N}개 종목 StockMeta 를 일괄 동기화한다.
 * - 앱 시작 시 1회 (Async). 직전 22:00 UTC 이후에 이미 동기화한 종목은 건너뛴다.
 * - 매일 UTC 22:00 장 마감 후 1회 (Async). 같은 UTC 날에 이미 받은 종목은 건너뛴다 — 정기
 *   동기화를 놓친 뒤 낮에 기동해 100회를 쓴 날, 22:00 에 또 100회를 쓰지 않게 한다.
 *
 * <p>FMP 는 하루 {@code FmpRateLimiter.DAILY_LIMIT}(240)회까지다. 상위 100개를 매번 다 받으면
 * 재배포 한 번에 100회가 더 들어 관심종목 메타 · 일봉 동기화와 합쳐 한도를 넘을 수 있다.
 * 그래서 기동 시에는 직전 정기 동기화 뒤로 받지 않은 종목만 받는다. 기준을 "N시간 이내"로
 * 두면 정기 동기화 몇 시간 전에 배포했을 때 같은 UTC 날에 100회를 두 번 쓰게 된다.
 *
 * <p>순위는 이미 저장된 시가총액 기준이다. 시가총액이 없는 종목은 sp500.csv 적재 순서(대략
 * 시가총액 순)로 뒤에 붙는다.
 *
 * <p>스케줄 메서드도 {@code @Async} 다. 100회를 0.5 req/s 로 부르면 약 200초가 걸리는데,
 * 기본 스케줄러 스레드는 하나뿐이라 그동안 다른 스케줄 작업이 모두 멈춘다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnExpression("!'${fmp.api-key:}'.isBlank()")
public class Sp500TopMetaSyncScheduler {

    static final int TOP_N = 100;

    /** 정기 동기화 시각(UTC). {@link #syncDaily()} 의 cron 과 같아야 한다. */
    static final LocalTime DAILY_SYNC_TIME_UTC = LocalTime.of(22, 0);

    private final StockMetaSyncService stockMetaSyncService;
    private final StockRepository stockRepository;

    /** 테스트에서 시각을 고정하기 위해 바꿀 수 있다. */
    private Clock clock = Clock.systemUTC();

    /** 기동 동기화와 정기 동기화가 겹치면 같은 종목을 두 번 부르게 되므로 하나만 돌린다. */
    private final AtomicBoolean running = new AtomicBoolean(false);

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** {@code now} 직전의 정기 동기화 시각. */
    static Instant startOfUtcDay(Instant now) {
        return now.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    static Instant lastDailySyncBoundary(Instant now) {
        ZonedDateTime utcNow = now.atZone(ZoneOffset.UTC);
        ZonedDateTime today = utcNow.toLocalDate().atTime(DAILY_SYNC_TIME_UTC).atZone(ZoneOffset.UTC);
        return (utcNow.isBefore(today) ? today.minusDays(1) : today).toInstant();
    }

    @Async
    @EventListener(ApplicationReadyEvent.class)
    public void syncOnStartup() {
        sync("startup", lastDailySyncBoundary(clock.instant()));
    }

    @Async
    @Scheduled(cron = "0 0 22 * * *", zone = "UTC")
    public void syncDaily() {
        sync("daily", startOfUtcDay(clock.instant()));
    }

    /**
     * @param freshAfter 이 시각 이후에 동기화한 종목은 건너뛴다. FMP 일일 카운터가 UTC 날짜
     *                   기준이라 같은 날 같은 종목을 두 번 부르지 않는 데 쓴다.
     */
    void sync(String trigger, Instant freshAfter) {
        if (!running.compareAndSet(false, true)) {
            log.info("[Sp500TopMetaSync][{}] 이전 동기화가 진행 중이라 건너뜁니다", trigger);
            return;
        }
        try {
            syncTop(trigger, freshAfter);
        } finally {
            running.set(false);
        }
    }

    private void syncTop(String trigger, Instant freshAfter) {
        List<Object[]> top = stockRepository.findAllActiveWithMetaSorted()
                .stream()
                .limit(TOP_N)
                .toList();
        if (top.isEmpty()) return;

        List<Stock> targets = top.stream()
                .filter(row -> !isFresh((StockMeta) row[1], freshAfter))
                .map(row -> (Stock) row[0])
                .toList();
        int skipped = top.size() - targets.size();

        if (targets.isEmpty()) {
            log.info("[Sp500TopMetaSync][{}] 상위 {}개 모두 최근 동기화됨 — skip", trigger, top.size());
            return;
        }

        log.info("[Sp500TopMetaSync][{}] 상위 {}개 중 {}개 StockMeta 동기화 시작 (최근 동기화 {}개 건너뜀)",
                trigger, top.size(), targets.size(), skipped);
        int success = 0, failed = 0;

        for (Stock stock : targets) {
            if (stock == null || stock.getId() == null) { failed++; continue; }
            try {
                if (stockMetaSyncService.syncTicker(stock.getId(), stock.getTicker(), SyncPriority.LOW)) {
                    success++;
                } else {
                    failed++;
                }
            } catch (Exception e) {
                failed++;
                log.warn("[Sp500TopMetaSync] {} 실패: {}", stock.getTicker(), e.getMessage());
            }
        }

        log.info("[Sp500TopMetaSync][{}] 완료 — success={} failed={}", trigger, success, failed);
    }

    private static boolean isFresh(StockMeta meta, Instant freshAfter) {
        return meta != null
                && meta.getMarketCapUsd() != null
                && meta.getLastSyncedAt() != null
                && !meta.getLastSyncedAt().isBefore(freshAfter);
    }
}
