package com.earningwhisperer.domain.stock;

import com.earningwhisperer.global.config.JpaConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@Import(JpaConfig.class)
@DisplayName("StockRepository 슬라이스 테스트")
class StockRepositoryTest {

    @Autowired private StockRepository stockRepository;
    @Autowired private StockMetaRepository stockMetaRepository;

    @Test
    @DisplayName("findAllActiveWithMetaSorted - 시가총액 내림차순, 시가총액이 없으면 적재 순서(id)로 뒤에 붙는다")
    void findAllActiveWithMetaSorted_시총순_후_id순() {
        Stock first = stockRepository.save(Stock.builder().ticker("AAA").companyName("A").sector("S").build());
        Stock second = stockRepository.save(Stock.builder().ticker("BBB").companyName("B").sector("S").build());
        Stock third = stockRepository.save(Stock.builder().ticker("CCC").companyName("C").sector("S").build());
        Stock fourth = stockRepository.save(Stock.builder().ticker("DDD").companyName("D").sector("S").build());
        stockMetaRepository.save(StockMeta.builder().stock(fourth).marketCapUsd(new BigDecimal("2000")).build());
        stockMetaRepository.save(StockMeta.builder().stock(second).marketCapUsd(new BigDecimal("1000")).build());

        List<String> tickers = stockRepository.findAllActiveWithMetaSorted().stream()
                .map(row -> ((Stock) row[0]).getTicker())
                .toList();

        assertThat(tickers).containsExactly("DDD", "BBB", "AAA", "CCC");
        assertThat(first.getId()).isLessThan(third.getId());
    }
}
