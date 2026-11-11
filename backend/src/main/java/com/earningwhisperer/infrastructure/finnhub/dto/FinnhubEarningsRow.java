package com.earningwhisperer.infrastructure.finnhub.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Finnhub `/stock/earnings?symbol={ticker}` 응답의 단일 분기 항목.
 *
 * <p>응답 예시:
 * <pre>
 * [
 *   {
 *     "actual": 1.88, "estimate": 1.43, "period": "2019-09-28",
 *     "quarter": 3, "surprise": 0.45, "surprisePercent": 31.4685,
 *     "symbol": "AAPL", "year": 2019
 *   }
 * ]
 * </pre>
 *
 * <p>응답 필드명이 짧아 일부는 명시 매핑 필요:
 * <ul>
 *     <li>{@code actual} → {@link #epsActual}</li>
 *     <li>{@code estimate} → {@link #epsEstimate}</li>
 *     <li>{@code quarter} 는 응답상 숫자(1~4) 이므로 String "Q{n}" 형태로 derived 사용은 호출자 책임.
 *         본 record 는 raw 값 보존을 위해 Integer 로 매핑한다.</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FinnhubEarningsRow(
        @JsonProperty("symbol") String symbol,

        @JsonProperty("period")
        @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd")
        LocalDate period,

        @JsonProperty("actual") BigDecimal epsActual,
        @JsonProperty("estimate") BigDecimal epsEstimate,
        @JsonProperty("surprise") BigDecimal surprise,
        @JsonProperty("surprisePercent") BigDecimal surprisePercent,

        /** Finnhub 응답상 숫자(1~4). 응답에 없으면 null — 호출자는 period 에서 derive 가능. */
        @JsonProperty("quarter") Integer quarter,

        /** 회계연도. MSFT 2026-09-30 분기는 year=2027 (FY27 Q1) 처럼 달력 연도와 다를 수 있다. */
        @JsonProperty("year") Integer year
) {

    /** 회계연도 없이 만드는 생성자(테스트 · 이전 응답 호환). */
    public FinnhubEarningsRow(String symbol, LocalDate period, BigDecimal epsActual, BigDecimal epsEstimate,
                              BigDecimal surprise, BigDecimal surprisePercent, Integer quarter) {
        this(symbol, period, epsActual, epsEstimate, surprise, surprisePercent, quarter, null);
    }

    /** "Q{n}" 형태 분기 라벨. quarter 가 null 이면 period 의 월에서 derive (1~3=Q1, ..., 10~12=Q4). */
    public String quarterLabel() {
        if (quarter != null) {
            return "Q" + quarter;
        }
        if (period != null) {
            int month = period.getMonthValue();
            int q = (month - 1) / 3 + 1;
            return "Q" + q;
        }
        return null;
    }
}
