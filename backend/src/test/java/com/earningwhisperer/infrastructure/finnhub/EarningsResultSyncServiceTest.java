package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.earnings.EarningsResult;
import com.earningwhisperer.domain.earnings.EarningsResultRepository;
import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.common.SyncPriority;
import com.earningwhisperer.infrastructure.finnhub.dto.FinnhubEarningsRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * {@link EarningsResultSyncService} 단위 테스트.
 *
 * <p>FinnhubClient / Repository mock — 외부 호출 / DB 미접근.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("EarningsResultSyncService 단위 테스트")
class EarningsResultSyncServiceTest {

    @Mock private FinnhubClient finnhubClient;
    @Mock private StockRepository stockRepository;
    @Mock private EarningsResultRepository earningsResultRepository;
    @Mock private EarningsReportDateResolver reportDateResolver;

    @InjectMocks
    private EarningsResultSyncService service;

    private Stock aapl;

    @BeforeEach
    void setUp() {
        aapl = stockOf(1L, "AAPL");
        // 실제 발표일. period(분기 말일)와 다르다.
        org.mockito.Mockito.lenient().when(reportDateResolver.reports(eq("AAPL"), any())).thenReturn(List.of(
                new EarningsReportDateResolver.Report(LocalDate.parse("2025-07-31"), new BigDecimal("1.50")),
                new EarningsReportDateResolver.Report(LocalDate.parse("2025-05-01"), new BigDecimal("1.30"))));
    }

    @Test
    @DisplayName("정상 케이스 — 신규 row 적재, builder 로 save, 신규 카운트 반환")
    void 신규_row_save() {
        FinnhubEarningsRow r1 = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                new BigDecimal("0.10"), new BigDecimal("7.1429"), 2);
        FinnhubEarningsRow r2 = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-03-31"),
                new BigDecimal("1.30"), new BigDecimal("1.20"),
                new BigDecimal("0.10"), new BigDecimal("8.3333"), 1);
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(r1, r2));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isEqualTo(2);
        ArgumentCaptor<EarningsResult> captor = ArgumentCaptor.forClass(EarningsResult.class);
        verify(earningsResultRepository, times(2)).save(captor.capture());
        List<EarningsResult> saved = captor.getAllValues();
        assertThat(saved).extracting(EarningsResult::getEpsActual)
                .containsExactly(new BigDecimal("1.50"), new BigDecimal("1.30"));
        assertThat(saved).extracting(EarningsResult::getFiscalPeriodLabel)
                .containsExactly("Q2 FY25", "Q1 FY25");
        // priceReactionPercent 는 null 로 영속화되어야 — 후속 PriceReactionCalculator 영역
        assertThat(saved).extracting(EarningsResult::getPriceReactionPercent)
                .containsOnlyNulls();
        // 모두 reattached stock 으로 영속화 (LAZY proxy 방지)
        assertThat(saved).allMatch(e -> e.getStock() == aapl);
    }

    @Test
    @DisplayName("같은 분기 라벨의 행이 있으면 updateActuals, 발표일 조회 · save 미호출, 신규 카운트 0")
    void 기존_row_update() {
        Instant announcedAt = LocalDate.parse("2025-07-31")
                .atTime(12, 0).toInstant(ZoneOffset.UTC);
        EarningsResult existing = EarningsResult.builder()
                .stock(aapl)
                .announcedAt(announcedAt)
                .fiscalPeriodLabel("Q2 FY25")
                .epsEstimate(new BigDecimal("1.00"))
                .epsActual(new BigDecimal("1.10"))
                .surprisePercent(new BigDecimal("10.0000"))
                .priceReactionPercent(new BigDecimal("3.5000"))
                .build();

        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                new BigDecimal("0.10"), new BigDecimal("7.1429"), 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));
        given(earningsResultRepository.findByStock_Id(1L)).willReturn(List.of(existing));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isZero();
        verify(earningsResultRepository, never()).save(any(EarningsResult.class));
        assertThat(existing.getEpsEstimate()).isEqualByComparingTo("1.40");
        assertThat(existing.getEpsActual()).isEqualByComparingTo("1.50");
        assertThat(existing.getSurprisePercent()).isEqualByComparingTo("7.1429");
        // priceReactionPercent 는 updateActuals 가 건드리지 않아야 — 가격반응 따로 채워짐
        assertThat(existing.getPriceReactionPercent()).isEqualByComparingTo("3.5000");
    }

    @Test
    @DisplayName("응답에 surprisePercent 가 없으면 (actual-estimate)/abs(estimate)*100 로 계산")
    void surprisePercent_보강_계산() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, null, 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isEqualTo(1);
        ArgumentCaptor<EarningsResult> captor = ArgumentCaptor.forClass(EarningsResult.class);
        verify(earningsResultRepository).save(captor.capture());
        // (1.50 - 1.40) / 1.40 * 100 = 7.1428571... → 6자리 HALF_UP → 7.142857 → *100 already
        // resolveSurprisePercent: divide(estimate.abs(), 6, HALF_UP).multiply(100)
        // (0.10).divide(1.40, 6, HALF_UP) = 0.071429 → *100 = 7.142900
        assertThat(captor.getValue().getSurprisePercent())
                .isEqualByComparingTo("7.1429");
    }

    @Test
    @DisplayName("epsEstimate 또는 epsActual 가 null 이면 surprisePercent 계산 skip → null 영속화")
    void surprisePercent_계산_skip() {
        // FinnhubEarningsRow record 인자 순서: (symbol, period, epsActual, epsEstimate, surprise, surprisePercent, quarter)
        // epsActual=null 케이스 (epsEstimate=1.40)
        FinnhubEarningsRow rowNullActual = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                null, new BigDecimal("1.40"),
                null, null, 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(rowNullActual));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        ArgumentCaptor<EarningsResult> captor = ArgumentCaptor.forClass(EarningsResult.class);
        verify(earningsResultRepository).save(captor.capture());
        assertThat(captor.getValue().getSurprisePercent()).isNull();
        assertThat(captor.getValue().getEpsActual()).isNull();
        assertThat(captor.getValue().getEpsEstimate()).isEqualByComparingTo("1.40");
    }

    @Test
    @DisplayName("epsEstimate=0 이면 surprisePercent 계산 분모 invalid → null")
    void surprisePercent_estimate_zero() {
        // FinnhubEarningsRow record 인자 순서: (symbol, period, epsActual, epsEstimate, surprise, surprisePercent, quarter)
        // epsActual=0.10, epsEstimate=0 → 분모 0
        BigDecimal result = EarningsResultSyncService.resolveSurprisePercent(
                new FinnhubEarningsRow("AAPL", LocalDate.parse("2025-06-30"),
                        new BigDecimal("0.10"), BigDecimal.ZERO, null, null, 2));
        assertThat(result).isNull();
    }

    @Test
    @DisplayName("발표일은 분기 말일(period)이 아니라 실제 발표일로 저장한다")
    void 실제_발표일로_저장() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, null, 3, 2025);
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        ArgumentCaptor<EarningsResult> captor = ArgumentCaptor.forClass(EarningsResult.class);
        verify(earningsResultRepository).save(captor.capture());
        assertThat(captor.getValue().getAnnouncedAt())
                .isEqualTo(LocalDate.parse("2025-07-31").atTime(12, 0).toInstant(ZoneOffset.UTC));
        assertThat(captor.getValue().getFiscalPeriodLabel()).isEqualTo("Q3 FY25");
    }

    @Test
    @DisplayName("발표일을 찾지 못한 분기는 period 로 대신 저장하지 않고 건너뛴다")
    void 발표일_없으면_건너뜀() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2024-12-31"),
                new BigDecimal("2.40"), new BigDecimal("2.35"),
                null, null, 1, 2025);
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isZero();
        verify(earningsResultRepository, never()).save(any(EarningsResult.class));
    }

    @Test
    @DisplayName("분기 라벨은 응답의 회계연도를 쓴다 (MSFT 2026-09-30 분기 = Q1 FY27)")
    void 회계연도_라벨() {
        FinnhubEarningsRow msft = new FinnhubEarningsRow(
                "MSFT", LocalDate.parse("2026-09-30"),
                new BigDecimal("4.89"), new BigDecimal("4.82"), null, null, 1, 2027);
        assertThat(EarningsResultSyncService.buildFiscalLabel(msft)).isEqualTo("Q1 FY27");
    }

    @Test
    @DisplayName("실제 발표일로 새 행을 넣으면 분기 말일로 저장된 예전 행을 지운다")
    void 예전_행_교체() {
        EarningsResult legacy = EarningsResult.builder().stock(aapl)
                .announcedAt(Instant.parse("2025-06-30T13:00:00Z")).fiscalPeriodLabel("Q3 FY25").build();
        given(earningsResultRepository.findByStock_Id(1L)).willReturn(List.of(legacy));
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(new FinnhubEarningsRow("AAPL", LocalDate.parse("2025-06-30"),
                        new BigDecimal("1.50"), new BigDecimal("1.40"), null, null, 3, 2025)));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isEqualTo(1);
        verify(earningsResultRepository).deleteAll(List.of(legacy));
    }

    @Test
    @DisplayName("발표일을 하나도 찾지 못하면 예전 행을 지우지 않는다 (FMP 장애 · 한도)")
    void 발표일_없으면_예전_행_유지() {
        EarningsResult legacy = EarningsResult.builder().stock(aapl)
                .announcedAt(Instant.parse("2025-06-30T13:00:00Z")).fiscalPeriodLabel("Q3 FY25").build();
        given(earningsResultRepository.findByStock_Id(1L)).willReturn(List.of(legacy));
        given(reportDateResolver.reports(eq("AAPL"), any())).willReturn(List.of());
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(new FinnhubEarningsRow("AAPL", LocalDate.parse("2025-06-30"),
                        new BigDecimal("1.50"), new BigDecimal("1.40"), null, null, 3, 2025)));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isZero();
        verify(earningsResultRepository, never()).deleteAll(any());
    }

    @Test
    @DisplayName("분기 말일 13:00 UTC 행만 예전 행이다 — 실제 발표일(12:00)이 분기 말일이어도 예전 행이 아니다")
    void 예전_행_판별() {
        assertThat(EarningsResultSyncService.isLegacy(Instant.parse("2026-09-30T13:00:00Z"))).isTrue();
        assertThat(EarningsResultSyncService.isLegacy(Instant.parse("2026-09-30T12:00:00Z"))).isFalse();
        assertThat(EarningsResultSyncService.isLegacy(Instant.parse("2026-08-20T13:00:00Z"))).isFalse();
        assertThat(EarningsResultSyncService.isLegacy(Instant.parse("2026-10-31T13:00:00Z"))).isFalse();
    }

    @Test
    @DisplayName("응답이 빈 리스트 → 0 반환, Stock reattach / save 미진입")
    void 빈_응답_0() {
        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of());

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isZero();
        verify(stockRepository, never()).findById(any());
        verify(earningsResultRepository, never()).save(any(EarningsResult.class));
    }

    @Test
    @DisplayName("Stock 미존재 (stockId / ticker 둘 다) → 0 반환, save 없음")
    void stock_미존재_0() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, new BigDecimal("7.14"), 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.empty());
        given(stockRepository.findByTicker("AAPL")).willReturn(Optional.empty());

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isZero();
        verify(earningsResultRepository, never()).save(any(EarningsResult.class));
    }

    @Test
    @DisplayName("announcedAt 은 실제 발표일의 12:00 UTC 다 (period 가 아니다)")
    void announcedAt_디폴트() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, new BigDecimal("7.14"), 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        ArgumentCaptor<EarningsResult> captor = ArgumentCaptor.forClass(EarningsResult.class);
        verify(earningsResultRepository).save(captor.capture());
        Instant expected = LocalDate.parse("2025-07-31").atTime(12, 0).toInstant(ZoneOffset.UTC);
        assertThat(captor.getValue().getAnnouncedAt()).isEqualTo(expected);
    }

    @Test
    @DisplayName("period 의 월에서 분기/연도 derive — quarter 가 응답에 있어도 응답값 우선")
    void fiscalPeriodLabel_derive() {
        // quarter 응답값 우선
        String label1 = EarningsResultSyncService.buildFiscalLabel(
                new FinnhubEarningsRow("X", LocalDate.parse("2025-06-30"),
                        null, null, null, null, 2));
        assertThat(label1).isEqualTo("Q2 FY25");

        // quarter null → period 의 월에서 derive (10월 = Q4)
        String label2 = EarningsResultSyncService.buildFiscalLabel(
                new FinnhubEarningsRow("X", LocalDate.parse("2024-10-31"),
                        null, null, null, null, null));
        assertThat(label2).isEqualTo("Q4 FY24");

        // 1월 = Q1, 연도 2자리
        String label3 = EarningsResultSyncService.buildFiscalLabel(
                new FinnhubEarningsRow("X", LocalDate.parse("2026-01-15"),
                        null, null, null, null, null));
        assertThat(label3).isEqualTo("Q1 FY26");
    }

    @Test
    @DisplayName("period 가 null 인 row 는 skip — 다른 row 영속화")
    void invalid_row_skip() {
        FinnhubEarningsRow invalid = new FinnhubEarningsRow(
                "AAPL", null, null, null, null, null, null);
        FinnhubEarningsRow valid = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, new BigDecimal("7.14"), 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(invalid, valid));
        given(stockRepository.findById(1L)).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(1L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isEqualTo(1);
        verify(earningsResultRepository, times(1)).save(any(EarningsResult.class));
    }

    @Test
    @DisplayName("stockId 미존재여도 ticker fallback 으로 reattach → 신규 적재")
    void ticker_fallback_reattach() {
        FinnhubEarningsRow row = new FinnhubEarningsRow(
                "AAPL", LocalDate.parse("2025-06-30"),
                new BigDecimal("1.50"), new BigDecimal("1.40"),
                null, new BigDecimal("7.14"), 2);

        given(finnhubClient.fetchEarningsHistory(eq("AAPL"), eq(FinnhubRateLimiter.Priority.LOW)))
                .willReturn(List.of(row));
        given(stockRepository.findById(99L)).willReturn(Optional.empty());
        given(stockRepository.findByTicker("AAPL")).willReturn(Optional.of(aapl));

        int inserted = service.syncTicker(99L, "AAPL", SyncPriority.LOW);

        assertThat(inserted).isEqualTo(1);
        verify(earningsResultRepository, times(1)).save(any(EarningsResult.class));
    }

    // ─────────── helpers ───────────

    private static Stock stockOf(Long id, String ticker) {
        Stock s = Stock.builder().ticker(ticker).companyName("Co").sector("TECH").build();
        try {
            Field idField = Stock.class.getDeclaredField("id");
            idField.setAccessible(true);
            idField.set(s, id);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return s;
    }
}
