package com.earningwhisperer.infrastructure.fmp.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * FMP `/stable/earnings?symbol=` 한 건. 실제 발표일(date)과 EPS 예상 · 실제를 준다.
 * 아직 발표 전인 다음 분기도 epsActual=null 로 함께 온다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FmpEarningsReport(
        @JsonProperty("symbol") String symbol,
        @JsonProperty("date") String date,
        @JsonProperty("epsActual") BigDecimal epsActual,
        @JsonProperty("epsEstimated") BigDecimal epsEstimated
) {}
