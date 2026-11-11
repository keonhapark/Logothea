package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.earnings.EarningsResult;
import com.earningwhisperer.domain.earnings.EarningsResultRepository;
import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.common.SyncPriority;
import com.earningwhisperer.infrastructure.fmp.DailyBarSyncService;
import com.earningwhisperer.infrastructure.fmp.FmpRateLimiter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 분기 말일을 발표일로 저장했던 어닝 결과를 바로잡는다.
 *
 * <p>예전 동기화는 Finnhub period(분기 말일)를 발표일로 저장해, "최근 어닝 반응" 의 날짜 · 가격반응 · 분기 라벨이
 * 모두 틀렸다. 기동 직후 그런 행이 있는 종목과 관심 · 보유 종목을 다시 동기화하고, 가격반응 계산에 필요한 1년치
 * 일봉을 채운 뒤 가격반응을 계산한다.
 *
 * <p>예전 행은 동기화가 그 종목의 실제 발표일을 찾았을 때만 같은 트랜잭션에서 지운다
 * ({@link EarningsResultSyncService#syncTicker}). FMP 가 비거나 한도에 걸리면 예전 행이 남고 다음 기동 때 다시 시도한다.
 * 예전 행이 없으면 아무것도 하지 않는다. FMP 일일 한도가 모자라면 남은 종목은 다음 기동으로 미룬다.
 * 기동을 막지 않도록 별도 스레드에서 돈다.
 */
@Component
@ConditionalOnExpression("!'${finnhub.api-key:}'.isBlank() && !'${fmp.api-key:}'.isBlank()"
        + " && '${earnings-result.repair-on-startup:true}' == 'true'")
@Slf4j
public class EarningsResultRepair {

    /** 가격반응 계산용 일봉 일수. 최근 4분기(약 1년) 발표일 전후를 덮는다. */
    static final int BACKFILL_DAYS = 400;
    /** 종목 하나에 쓰는 FMP 호출(발표 이력 1 + 일봉 1)과, 그날 저녁 정기 동기화를 위해 남겨 둘 몫. */
    static final int FMP_CALLS_PER_TICKER = 2;
    static final int FMP_RESERVE = 150;

    private final EarningsResultRepository earningsResultRepository;
    private final StockRepository stockRepository;
    private final EarningsResultSyncService syncService;
    private final EarningsResultSyncScheduler syncScheduler;
    private final ObjectProvider<DailyBarSyncService> dailyBarSyncService;
    private final ObjectProvider<FmpRateLimiter> fmpRateLimiter;
    private final PriceReactionCalculatorService priceReactionCalculator;

    public EarningsResultRepair(EarningsResultRepository earningsResultRepository,
                                StockRepository stockRepository,
                                EarningsResultSyncService syncService,
                                EarningsResultSyncScheduler syncScheduler,
                                ObjectProvider<DailyBarSyncService> dailyBarSyncService,
                                ObjectProvider<FmpRateLimiter> fmpRateLimiter,
                                PriceReactionCalculatorService priceReactionCalculator) {
        this.earningsResultRepository = earningsResultRepository;
        this.stockRepository = stockRepository;
        this.syncService = syncService;
        this.syncScheduler = syncScheduler;
        this.dailyBarSyncService = dailyBarSyncService;
        this.fmpRateLimiter = fmpRateLimiter;
        this.priceReactionCalculator = priceReactionCalculator;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void repairInBackground() {
        Thread worker = new Thread(this::repair, "earnings-result-repair");
        worker.setDaemon(true);
        worker.start();
    }

    void repair() {
        try {
            List<Long> legacyStockIds = earningsResultRepository.findAll().stream()
                    .filter(er -> EarningsResultSyncService.isLegacy(er.getAnnouncedAt()))
                    .map(er -> er.getStock().getId())
                    .distinct()
                    .toList();
            if (legacyStockIds.isEmpty()) {
                log.info("[EarningsResultRepair] 바로잡을 행이 없습니다");
                return;
            }

            // 행의 stock 은 지연 로딩 프록시라 세션 밖에서 ticker 를 읽을 수 없다. id 로 다시 읽는다.
            Map<Long, Stock> targets = new LinkedHashMap<>();
            stockRepository.findAllById(legacyStockIds).forEach(s -> targets.putIfAbsent(s.getId(), s));
            syncScheduler.targetStocks().forEach(s -> targets.putIfAbsent(s.getId(), s));
            log.info("[EarningsResultRepair] 예전 행이 있는 {}종목 포함 {}종목을 다시 받습니다",
                    legacyStockIds.size(), targets.size());

            DailyBarSyncService bars = dailyBarSyncService.getIfAvailable();
            FmpRateLimiter limiter = fmpRateLimiter.getIfAvailable();
            int inserted = 0;
            int done = 0;
            for (Stock stock : targets.values()) {
                if (limiter != null && limiter.getRemainingDailyQuota() < FMP_CALLS_PER_TICKER + FMP_RESERVE) {
                    log.warn("[EarningsResultRepair] FMP 일일 한도가 모자라 {}종목에서 멈춥니다 — 다음 기동 때 이어서 합니다",
                            done);
                    break;
                }
                try {
                    inserted += syncService.syncTicker(stock.getId(), stock.getTicker(), SyncPriority.LOW);
                    if (bars != null) {
                        bars.syncTicker(stock.getId(), stock.getTicker(), BACKFILL_DAYS, SyncPriority.LOW);
                    }
                } catch (RuntimeException e) {
                    log.warn("[EarningsResultRepair] {} 다시 받기 실패", stock.getTicker(), e);
                }
                done++;
            }

            int computed = 0;
            for (EarningsResult er : earningsResultRepository.findByPriceReactionPercentIsNullAndAnnouncedAtAfter(
                    Instant.now().minusSeconds(BACKFILL_DAYS * 86_400L))) {
                if (priceReactionCalculator.computeAndUpdate(er.getId()) == PriceReactionResult.COMPUTED) {
                    computed++;
                }
            }
            log.info("[EarningsResultRepair] 완료 — {}종목, 새 행 {}건, 가격반응 계산 {}건", done, inserted, computed);
        } catch (RuntimeException e) {
            log.error("[EarningsResultRepair] 실패 — 다음 기동 때 다시 시도합니다", e);
        }
    }
}
