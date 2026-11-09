package com.earningwhisperer.infrastructure.fmp;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockMeta;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.common.SyncPriority;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
@DisplayName("Sp500TopMetaSyncScheduler 상위 100 메타 동기화")
class Sp500TopMetaSyncSchedulerTest {

    @Mock private StockMetaSyncService stockMetaSyncService;
    @Mock private StockRepository stockRepository;

    @InjectMocks private Sp500TopMetaSyncScheduler scheduler;

    private static Stock stock(long id, String ticker) {
        Stock s = Stock.builder().ticker(ticker).companyName("C").sector("S").build();
        ReflectionTestUtils.setField(s, "id", id);
        return s;
    }

    private static StockMeta meta(Stock s, Instant syncedAt) {
        return StockMeta.builder().stock(s).marketCapUsd(new BigDecimal("1000")).lastSyncedAt(syncedAt).build();
    }

    @Test
    @DisplayName("상위 100개까지만 동기화한다")
    void 상위_100개() {
        List<Object[]> rows = new ArrayList<>();
        for (int i = 1; i <= 120; i++) {
            rows.add(new Object[]{stock(i, "T" + i), null});
        }
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(rows);
        given(stockMetaSyncService.syncTicker(anyLong(), anyString(), any())).willReturn(true);

        scheduler.syncDaily();

        verify(stockMetaSyncService, times(100)).syncTicker(anyLong(), anyString(), eq(SyncPriority.LOW));
        verify(stockMetaSyncService).syncTicker(100L, "T100", SyncPriority.LOW);
        verify(stockMetaSyncService, never()).syncTicker(eq(101L), anyString(), any());
    }

    @Test
    @DisplayName("기동 시에는 직전 22:00 UTC 이후에 동기화한 종목을 건너뛴다")
    void 기동_시_최근_동기화_건너뜀() {
        // 20:00 UTC 기동 — 직전 정기 동기화는 전날 22:00
        scheduler.setClock(Clock.fixed(Instant.parse("2026-11-10T20:00:00Z"), ZoneOffset.UTC));
        Stock fresh = stock(1, "FRESH");
        Stock stale = stock(2, "STALE");
        Stock noMeta = stock(3, "NOMETA");
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(List.of(
                // 전날 22:03 정기 동기화분 — 22시간 전이지만 같은 주기라 건너뛴다
                new Object[]{fresh, meta(fresh, Instant.parse("2026-11-09T22:03:00Z"))},
                new Object[]{stale, meta(stale, Instant.parse("2026-11-09T21:00:00Z"))},
                new Object[]{noMeta, null}
        ));
        given(stockMetaSyncService.syncTicker(anyLong(), anyString(), any())).willReturn(true);

        scheduler.syncOnStartup();

        verify(stockMetaSyncService, never()).syncTicker(eq(1L), anyString(), any());
        verify(stockMetaSyncService).syncTicker(2L, "STALE", SyncPriority.LOW);
        verify(stockMetaSyncService).syncTicker(3L, "NOMETA", SyncPriority.LOW);
    }

    @Test
    @DisplayName("매일 동기화는 같은 UTC 날에 이미 받은 종목만 건너뛰고 나머지는 다시 받는다")
    void 매일_동기화는_오늘_받은_것만_건너뜀() {
        scheduler.setClock(Clock.fixed(Instant.parse("2026-11-10T22:00:00Z"), ZoneOffset.UTC));
        Stock today = stock(1, "TODAY");
        Stock yesterday = stock(2, "YESTERDAY");
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(List.of(
                // 정기 동기화를 놓친 뒤 01:00 UTC 기동에서 받은 종목
                new Object[]{today, meta(today, Instant.parse("2026-11-10T01:00:00Z"))},
                new Object[]{yesterday, meta(yesterday, Instant.parse("2026-11-09T22:02:00Z"))}
        ));
        given(stockMetaSyncService.syncTicker(anyLong(), anyString(), any())).willReturn(true);

        scheduler.syncDaily();

        verify(stockMetaSyncService, never()).syncTicker(eq(1L), anyString(), any());
        verify(stockMetaSyncService).syncTicker(2L, "YESTERDAY", SyncPriority.LOW);
    }

    @Test
    @DisplayName("직전 정기 동기화 시각은 22:00 UTC 전이면 전날, 후면 당일이다")
    void 직전_정기_동기화_시각() {
        assertThat(Sp500TopMetaSyncScheduler.lastDailySyncBoundary(Instant.parse("2026-11-10T21:59:59Z")))
                .isEqualTo(Instant.parse("2026-11-09T22:00:00Z"));
        assertThat(Sp500TopMetaSyncScheduler.lastDailySyncBoundary(Instant.parse("2026-11-10T22:00:00Z")))
                .isEqualTo(Instant.parse("2026-11-10T22:00:00Z"));
        assertThat(Sp500TopMetaSyncScheduler.lastDailySyncBoundary(Instant.parse("2026-11-11T03:00:00Z")))
                .isEqualTo(Instant.parse("2026-11-10T22:00:00Z"));
    }

    @Test
    @DisplayName("기동 동기화가 도는 중에 정기 동기화가 오면 건너뛴다")
    void 겹침_실행_방지() {
        Stock a = stock(1, "AAA");
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(List.<Object[]>of(new Object[]{a, null}));
        given(stockMetaSyncService.syncTicker(anyLong(), anyString(), any())).willAnswer(inv -> {
            scheduler.syncDaily();
            return true;
        });

        scheduler.syncOnStartup();

        verify(stockMetaSyncService, times(1)).syncTicker(anyLong(), anyString(), any());
    }

    @Test
    @DisplayName("모두 최근에 받았으면 FMP 를 부르지 않는다")
    void 모두_최근이면_호출_없음() {
        Stock fresh = stock(1, "FRESH");
        given(stockRepository.findAllActiveWithMetaSorted()).willReturn(List.<Object[]>of(
                new Object[]{fresh, meta(fresh, Instant.now())}));

        scheduler.syncOnStartup();

        verifyNoInteractions(stockMetaSyncService);
    }
}
