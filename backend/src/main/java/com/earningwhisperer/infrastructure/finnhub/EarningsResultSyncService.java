package com.earningwhisperer.infrastructure.finnhub;

import com.earningwhisperer.domain.earnings.EarningsResult;
import com.earningwhisperer.domain.earnings.EarningsResultRepository;
import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.global.common.SyncPriority;
import com.earningwhisperer.infrastructure.finnhub.dto.FinnhubEarningsRow;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

/**
 * 한 ticker 단위 어닝 결과(EPS surprise) 동기화의 영속화 책임을 가진 서비스.
 *
 * <p>{@link com.earningwhisperer.infrastructure.fmp.StockMetaSyncService} 와 동일한 패턴:
 * ticker 단위 {@code @Transactional} 격리 — 한 ticker 의 JPA 예외가 다른 ticker 의 commit 을
 * rollback-only 로 만들지 않도록 빈을 분리한다 (스케줄러 self-invocation 함정 회피).
 *
 * <p>FINNHUB_API_KEY 미설정 시 Bean 미등록(@ConditionalOnExpression).
 */
@Service
@ConditionalOnExpression("!'${finnhub.api-key:}'.isBlank()")
@RequiredArgsConstructor
@Slf4j
public class EarningsResultSyncService {

    /**
     * 발표일에 붙이는 시각. 발표 시각(장 전 · 장 후)은 모르므로 날짜만 의미가 있다 — 가격반응 계산기는
     * 발표일 직전 · 직후 거래일 종가를 쓴다.
     *
     * <p>12:00 으로 둔다. 예전 동기화는 분기 말일을 13:00 으로 저장했고({@link #isLegacy}), 시각을 다르게 해야
     * 실제 발표일이 분기 말일인 회사의 행을 예전 행으로 오인하지 않는다.
     */
    static final LocalTime DEFAULT_ANNOUNCEMENT_TIME = LocalTime.of(12, 0);
    private static final LocalTime LEGACY_TIME = LocalTime.of(13, 0);
    private static final java.util.Set<java.time.Month> QUARTER_END_MONTHS = java.util.EnumSet.of(
            java.time.Month.MARCH, java.time.Month.JUNE, java.time.Month.SEPTEMBER, java.time.Month.DECEMBER);

    /**
     * surprisePercent 계산 시 BigDecimal divide 에 적용할 scale.
     * 응답 컬럼 {@code DECIMAL(8,4)} 한도에 맞춰 4자리 + 여유분.
     */
    private static final int SURPRISE_SCALE = 6;

    private final FinnhubClient finnhubClient;
    private final StockRepository stockRepository;
    private final EarningsResultRepository earningsResultRepository;
    private final EarningsReportDateResolver reportDateResolver;

    /**
     * 한 ticker 의 fetchEarningsHistory + (stock_id, announced_at) upsert.
     *
     * <p>의미적 책임:
     * <ul>
     *     <li>응답 비어있음 → {@code 0} 반환</li>
     *     <li>Stock 미존재 → {@code 0} 반환 (영속화 미진입)</li>
     *     <li>각 row 별 unique constraint 매칭으로 update / insert 분기. 신규 insert 만 카운트.</li>
     * </ul>
     *
     * @param stockId  영속화 대상 Stock 의 PK
     * @param ticker   외부 호출 키
     * @param priority Finnhub rate limiter 우선순위 (사용자 trigger=HIGH, 사전 동기화=LOW)
     * @return 신규 insert 된 row 수 (스케줄러 사이클 요약용)
     */
    @Transactional
    public int syncTicker(Long stockId, String ticker, SyncPriority priority) {
        List<FinnhubEarningsRow> rows = finnhubClient.fetchEarningsHistory(
                ticker, priority.toFinnhub());

        if (rows.isEmpty()) {
            log.warn("[EarningsResultSync] earnings 조회 실패/빈 응답 ticker={}", ticker);
            return 0;
        }

        // 트랜잭션 분리 후에는 외부 트랜잭션이 없으므로 stockId 로 reattach.
        // stockId 가 invalidated 된 경우(삭제 race) ticker 로 fallback.
        Stock attached = stockRepository.findById(stockId)
                .orElseGet(() -> stockRepository.findByTicker(ticker).orElse(null));
        if (attached == null) {
            log.warn("[EarningsResultSync] Stock 미존재 ticker={} stockId={} — skip", ticker, stockId);
            return 0;
        }

        // 이미 실제 발표일로 저장한 분기는 라벨로 찾아 EPS 만 갱신한다 — 발표일 조회(FMP)는 새 분기가 있을 때만 한다.
        List<EarningsResult> existing = earningsResultRepository.findByStock_Id(attached.getId());
        java.util.Map<String, EarningsResult> byLabel = new java.util.HashMap<>();
        java.util.Set<LocalDate> usedDates = new java.util.HashSet<>();
        List<EarningsResult> legacy = new java.util.ArrayList<>();
        for (EarningsResult er : existing) {
            if (isLegacy(er.getAnnouncedAt())) {
                legacy.add(er);
            } else {
                byLabel.putIfAbsent(er.getFiscalPeriodLabel(), er);
                usedDates.add(er.getAnnouncedAt().atZone(ZoneOffset.UTC).toLocalDate());
            }
        }

        List<EarningsReportDateResolver.Report> reports = null;
        int inserted = 0;
        for (FinnhubEarningsRow row : rows) {
            if (row.period() == null) continue;
            String fiscalLabel = buildFiscalLabel(row);
            BigDecimal surprisePercent = resolveSurprisePercent(row);

            EarningsResult known = byLabel.get(fiscalLabel);
            if (known != null) {
                known.updateActuals(row.epsEstimate(), row.epsActual(), surprisePercent);
                continue;
            }
            if (reports == null) {
                reports = reportDateResolver.reports(ticker, priority);
            }
            // period 는 분기 말일이라 발표일로 쓰면 가격반응이 엉뚱한 날짜로 계산된다. 발표일을 못 찾으면 저장하지 않는다.
            Optional<LocalDate> reportDate =
                    EarningsReportDateResolver.match(row.period(), row.epsActual(), reports, usedDates);
            if (reportDate.isEmpty()) {
                log.info("[EarningsResultSync] 발표일을 찾지 못해 건너뜁니다 ticker={} period={}", ticker, row.period());
                continue;
            }
            usedDates.add(reportDate.get());
            Instant announcedAt = reportDate.get()
                    .atTime(DEFAULT_ANNOUNCEMENT_TIME)
                    .toInstant(ZoneOffset.UTC);
            EarningsResult saved = earningsResultRepository.save(EarningsResult.builder()
                    .stock(attached)
                    .announcedAt(announcedAt)
                    .fiscalPeriodLabel(fiscalLabel)
                    .epsEstimate(row.epsEstimate())
                    .epsActual(row.epsActual())
                    .surprisePercent(surprisePercent)
                    .priceReactionPercent(null)
                    .build());
            byLabel.put(fiscalLabel, saved);
            inserted++;
        }

        // 실제 발표일로 새 행을 넣었을 때만 예전 행을 같은 트랜잭션에서 지운다. 발표일을 하나도 못 찾았으면(FMP 장애 ·
        // 한도) 예전 행을 그대로 두어, 화면이 비지 않고 다음 동기화에서 다시 바로잡는다.
        if (inserted > 0 && !legacy.isEmpty()) {
            earningsResultRepository.deleteAll(legacy);
            log.info("[EarningsResultSync] 분기 말일로 저장된 예전 행 {}건을 지웠습니다 ticker={}", legacy.size(), ticker);
        }
        return inserted;
    }

    /**
     * 예전 동기화가 Finnhub period(분기 말일)를 발표일로 쓴 행인지. 분기 말일(3 · 6 · 9 · 12월 말일) 13:00 UTC.
     * 지금 동기화는 실제 발표일을 12:00 으로 저장하므로 겹치지 않는다.
     */
    public static boolean isLegacy(Instant announcedAt) {
        if (announcedAt == null) {
            return false;
        }
        java.time.ZonedDateTime at = announcedAt.atZone(ZoneOffset.UTC);
        LocalDate date = at.toLocalDate();
        return at.toLocalTime().equals(LEGACY_TIME)
                && QUARTER_END_MONTHS.contains(date.getMonth())
                && date.getDayOfMonth() == date.lengthOfMonth();
    }

    /**
     * surprisePercent 결정.
     *
     * <p>응답 필드가 있으면 그대로. 없으면 {@code (actual - estimate) / abs(estimate) * 100} 로 보강.
     * estimate=0 / 둘 중 하나 null 인 경우는 계산 불가 → null.
     */
    static BigDecimal resolveSurprisePercent(FinnhubEarningsRow row) {
        if (row.surprisePercent() != null) {
            return row.surprisePercent();
        }
        BigDecimal actual = row.epsActual();
        BigDecimal estimate = row.epsEstimate();
        if (actual == null || estimate == null || estimate.signum() == 0) {
            return null;
        }
        return actual.subtract(estimate)
                .divide(estimate.abs(), SURPRISE_SCALE, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100));
    }

    /**
     * fiscalPeriodLabel 결정.
     *
     * <p>"Q{n} FY{yy}" 형태. quarter · year(회계연도)가 응답에 있으면 그대로 쓰고,
     * year 가 없을 때만 period 의 달력 연도로 대신한다.
     */
    static String buildFiscalLabel(FinnhubEarningsRow row) {
        String quarter = row.quarterLabel();
        if (quarter == null) {
            quarter = "Q?";
        }
        // 회계연도가 오면 그대로 쓴다. 달력 연도로 대신하면 6월 결산(MSFT) · 1월 결산(WMT) 회사의 라벨이 1년 틀린다.
        if (row.year() != null) {
            return String.format("%s FY%02d", quarter, row.year() % 100);
        }
        if (row.period() == null) {
            return quarter + " FY??";
        }
        int yy = row.period().getYear() % 100;
        return String.format("%s FY%02d", quarter, yy);
    }
}
