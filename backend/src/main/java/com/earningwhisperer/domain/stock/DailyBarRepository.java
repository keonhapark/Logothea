package com.earningwhisperer.domain.stock;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DailyBarRepository extends JpaRepository<DailyBar, Long> {

    List<DailyBar> findTop30ByStock_IdOrderByBarDateDesc(Long stockId);

    Optional<DailyBar> findByStock_IdAndBarDate(Long stockId, LocalDate barDate);

    List<DailyBar> findByStock_IdAndBarDateBetween(Long stockId, LocalDate from, LocalDate to);

    /**
     * {@code [from, toExclusive)} 기간의 봉 가운데 가장 최근 종가를 ticker 별로 일괄 조회한다.
     * 기간 안에 봉이 없는 ticker 는 결과에서 빠진다.
     *
     * <p>현재가 · 전일종가 용도다. 하한을 두는 이유는 일봉이 매일 갱신되지 않는 종목이 있어서다.
     * 관심 · 보유 종목만 매일 동기화되고, 상세 화면에서 한 번 받은 종목은 그 뒤로 봉이 쌓이지
     * 않는다. 하한 없이 "마지막 봉"을 쓰면 몇 달 전 종가가 전일종가가 되어 없던 폭락이 뜬다.
     * 상한(배타)을 오늘로 두면 장 마감 뒤 적재된 당일 봉을 전일종가로 쓰지 않는다.
     *
     * <p>close_price 는 BigDecimal 컬럼이므로 cast(... as double) 로 명시 변환 — H2 / MySQL 양쪽 모두
     * Hibernate 6 표준 함수로 동일하게 동작한다.
     */
    @Query("""
            SELECT new com.earningwhisperer.domain.stock.TickerLatestClose(
                       s.ticker, cast(db.closePrice as double))
            FROM DailyBar db JOIN db.stock s
            WHERE s.ticker IN :tickers
              AND db.barDate = (
                  SELECT MAX(db2.barDate) FROM DailyBar db2
                  WHERE db2.stock.id = s.id
                    AND db2.barDate >= :from AND db2.barDate < :toExclusive
              )
            """)
    List<TickerLatestClose> findLatestClosesInRange(@Param("tickers") Collection<String> tickers,
                                                    @Param("from") LocalDate from,
                                                    @Param("toExclusive") LocalDate toExclusive);
}
