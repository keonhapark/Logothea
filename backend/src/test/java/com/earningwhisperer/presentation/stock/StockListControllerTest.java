package com.earningwhisperer.presentation.stock;

import com.earningwhisperer.domain.stock.Stock;
import com.earningwhisperer.domain.stock.StockMeta;
import com.earningwhisperer.domain.stock.StockPriceSnapshot;
import com.earningwhisperer.domain.stock.StockRepository;
import com.earningwhisperer.infrastructure.websocket.StockPriceCache;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link StockListController} 슬라이스 테스트. 인증 없이 열린 경로라 사용자 모킹이 없다.
 */
@WebMvcTest(StockListController.class)
@Import({
        com.earningwhisperer.global.config.SecurityConfig.class,
        com.earningwhisperer.global.exception.GlobalExceptionHandler.class
})
@DisplayName("StockListController 슬라이스 테스트")
class StockListControllerTest {

    @Autowired MockMvc mockMvc;

    @MockBean StockRepository stockRepository;
    @MockBean StockPriceCache priceCache;
    @MockBean com.earningwhisperer.infrastructure.security.JwtProvider jwtProvider;
    @MockBean com.earningwhisperer.infrastructure.security.UserDetailsServiceImpl userDetailsService;

    private static Stock stock(String ticker) {
        return Stock.builder().ticker(ticker).companyName(ticker + " Inc.").sector("Information Technology").build();
    }

    private static StockMeta meta(Stock s, String cap) {
        return StockMeta.builder().stock(s).marketCapUsd(cap == null ? null : new BigDecimal(cap)).build();
    }

    @Test
    @DisplayName("시가총액 순위와 가격 필드를 내려 주고, 값이 없으면 null 로 둔다")
    void 순위와_가격() throws Exception {
        Stock aapl = stock("AAPL");
        Stock msft = stock("MSFT");
        Stock zero = stock("ZERO");
        Stock none = stock("NONE");
        when(stockRepository.findAllActiveWithMetaSorted()).thenReturn(List.of(
                new Object[]{aapl, meta(aapl, "3000000000000")},
                new Object[]{msft, meta(msft, "2900000000000")},
                new Object[]{zero, meta(zero, "0")},
                new Object[]{none, null}
        ));
        when(priceCache.getAllAsMap()).thenReturn(Map.of(
                "AAPL", StockPriceSnapshot.of("AAPL", 105.0, 100.0, 1L),
                // 일봉도 시세도 없이 적재된 종목: 현재가 · 전일종가 0
                "MSFT", StockPriceSnapshot.of("MSFT", 0.0, 0.0, 1L),
                // 체결은 왔지만 전일종가를 모르는 종목
                "ZERO", StockPriceSnapshot.of("ZERO", 50.0, 0.0, 1L)
        ));

        mockMvc.perform(get("/api/v1/stocks/sp500"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ticker").value("AAPL"))
                .andExpect(jsonPath("$[0].sector").value("Information Technology"))
                .andExpect(jsonPath("$[0].marketCapUsd").value(3.0e12))
                .andExpect(jsonPath("$[0].marketCapRank").value(1))
                .andExpect(jsonPath("$[0].currentPrice").value(105.0))
                .andExpect(jsonPath("$[0].previousClose").value(100.0))
                .andExpect(jsonPath("$[0].changePercent", closeTo(5.0, 1e-9)))
                .andExpect(jsonPath("$[1].marketCapRank").value(2))
                .andExpect(jsonPath("$[1].currentPrice").value(nullValue()))
                .andExpect(jsonPath("$[1].previousClose").value(nullValue()))
                .andExpect(jsonPath("$[1].changePercent").value(nullValue()))
                // 시가총액 0 은 "없음"으로 본다
                .andExpect(jsonPath("$[2].marketCapUsd").value(nullValue()))
                .andExpect(jsonPath("$[2].marketCapRank").value(nullValue()))
                .andExpect(jsonPath("$[2].currentPrice").value(50.0))
                .andExpect(jsonPath("$[2].previousClose").value(nullValue()))
                .andExpect(jsonPath("$[2].changePercent").value(nullValue()))
                // 메타도 시세도 없는 종목
                .andExpect(jsonPath("$[3].marketCapRank").value(nullValue()))
                .andExpect(jsonPath("$[3].currentPrice").value(nullValue()));
    }
}
