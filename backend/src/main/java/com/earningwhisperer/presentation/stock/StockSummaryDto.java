package com.earningwhisperer.presentation.stock;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * S&P 500 종목 한 줄.
 *
 * <p>가격 세 값(currentPrice · previousClose · changePercent)은 데이터가 없으면 {@code null} 이다.
 * 0 은 "변동 없음"이고 null 은 "모름"이라, 시장 지도가 둘을 구분해 칠할 수 있게 한다.
 *
 * <p>{@code marketCapRank} 는 시가총액이 있는 종목 가운데 내림차순 순위(1부터)다.
 * 시가총액이 없으면 {@code null} 이다.
 */
public record StockSummaryDto(
        String ticker,
        @JsonProperty("companyName") String companyName,
        String sector,
        @JsonProperty("marketCapUsd") Double marketCapUsd,
        @JsonProperty("marketCapRank") Integer marketCapRank,
        @JsonProperty("currentPrice") Double currentPrice,
        @JsonProperty("previousClose") Double previousClose,
        @JsonProperty("changePercent") Double changePercent
) {}
