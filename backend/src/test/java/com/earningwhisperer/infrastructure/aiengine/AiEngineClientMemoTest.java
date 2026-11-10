package com.earningwhisperer.infrastructure.aiengine;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("AiEngineClient 응답 기억")
class AiEngineClientMemoTest {

    private HttpServer server;
    private final Map<String, AtomicInteger> hits = new ConcurrentHashMap<>();
    private final Map<String, String> bodies = new ConcurrentHashMap<>();
    private AiEngineClient client;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (String path : List.of("/v1/engine/live-fact-check/sentence", "/v1/engine/transcript/translate",
                "/v1/engine/transcript/diff", "/v1/engine/analyze", "/v1/engine/earnings/intelligence")) {
            server.createContext(path, exchange -> {
                hits.computeIfAbsent(path, p -> new AtomicInteger()).incrementAndGet();
                byte[] body = bodies.getOrDefault(path, "{}").getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
        }
        server.start();
        client = new AiEngineClient("http://127.0.0.1:" + server.getAddress().getPort(),
                true, true, true, true, 2_000, 2_000);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private int hits(String path) {
        AtomicInteger count = hits.get(path);
        return count == null ? 0 : count.get();
    }

    private static LiveFactCheckModels.SentenceRequest sentence(int sequence) {
        return new LiveFactCheckModels.SentenceRequest("WMT", "Revenue grew.", sequence, 1_787_000_000L, false);
    }

    @Test
    @DisplayName("꺼져 있으면 같은 요청도 매번 부른다")
    void disabledCallsEveryTime() {
        client.submitSentence(sentence(0));
        client.submitSentence(sentence(0));

        assertThat(hits("/v1/engine/live-fact-check/sentence")).isEqualTo(2);
    }

    @Test
    @DisplayName("팩트체크는 엔진이 상태를 가져 켜져 있어도 기억하지 않는다")
    void neverMemoizesFactCheck() {
        client.setMemoEnabled(true);

        client.submitSentence(sentence(0));
        client.submitSentence(sentence(0));

        assertThat(hits("/v1/engine/live-fact-check/sentence")).isEqualTo(2);
    }

    @Test
    @DisplayName("대조는 결과가 있거나 주제 무관 판정일 때만 기억하고, 근거 부족 같은 실패는 다시 묻는다")
    void memoizesDiffOnlyWhenUsable() {
        client.setMemoEnabled(true);
        var request = TranscriptDiffModels.DiffRequest.forEarningsCall("WMT", "Guidance raised.", 1_787_000_000L);

        bodies.put("/v1/engine/transcript/diff",
                "{\"available\":false,\"ticker\":\"WMT\",\"items\":[],\"warnings\":[\"weak_prior_transcript_evidence\"]}");
        client.transcriptDiff(request);
        client.transcriptDiff(request);
        assertThat(hits("/v1/engine/transcript/diff")).isEqualTo(2);

        bodies.put("/v1/engine/transcript/diff",
                "{\"available\":true,\"ticker\":\"WMT\",\"items\":[],\"warnings\":[\"current_chunk_not_material\"]}");
        client.transcriptDiff(request);
        client.transcriptDiff(request);
        assertThat(hits("/v1/engine/transcript/diff")).isEqualTo(3);
    }

    @Test
    @DisplayName("번역은 call_id 가 달라도 같은 문장이면 다시 쓰고, 쓸 수 없는 응답은 기억하지 않는다")
    void memoizesTranslationAcrossRounds() {
        client.setMemoEnabled(true);
        bodies.put("/v1/engine/transcript/translate", "{\"available\":false,\"sequence\":0}");
        var request1 = new TranscriptTranslationModels.TranslateRequest("WMT", "round-1", 0, "Hello", List.of());
        client.translate(request1);
        client.translate(request1);
        assertThat(hits("/v1/engine/transcript/translate")).isEqualTo(2);

        bodies.put("/v1/engine/transcript/translate",
                "{\"available\":true,\"sequence\":0,\"text_ko\":\"안녕하세요\",\"terms_used\":[],\"warnings\":[]}");
        client.translate(request1);
        var round2 = client.translate(new TranscriptTranslationModels.TranslateRequest("WMT", "round-2", 0, "Hello", List.of()));

        assertThat(hits("/v1/engine/transcript/translate")).isEqualTo(3);
        assertThat(round2.orElseThrow().textKo()).isEqualTo("안녕하세요");
    }

    @Test
    @DisplayName("종합 판단은 가격(market_data)이 달라도 같은 전문이면 다시 쓴다")
    void memoizesAnalyzeIgnoringMarketData() {
        client.setMemoEnabled(true);
        bodies.put("/v1/engine/analyze",
                "{\"analysis\":{\"direction\":\"BULLISH\",\"confidence\":0.6,\"rationale\":\"r\"}}");

        client.analyze(new EarningsSummaryModels.AnalyzeRequest("WMT", "전문", true, Map.of("current_price", 100)));
        var second = client.analyze(new EarningsSummaryModels.AnalyzeRequest("WMT", "전문", true, Map.of("current_price", 101)));

        assertThat(hits("/v1/engine/analyze")).isEqualTo(1);
        assertThat(second).isPresent();
    }

    @Test
    @DisplayName("부가 정보(intelligence)도 가격을 빼고 같은 요청이면 다시 쓴다")
    void memoizesIntelligenceIgnoringMarketData() {
        client.setMemoEnabled(true);

        client.earningsIntelligence(new EarningsSummaryModels.IntelligenceRequest(
                "WMT", "전문", null, null, List.of(), Map.of("current_price", 100), "BULLISH", 0.6));
        client.earningsIntelligence(new EarningsSummaryModels.IntelligenceRequest(
                "WMT", "전문", null, null, List.of(), Map.of("current_price", 102), "BULLISH", 0.6));

        assertThat(hits("/v1/engine/earnings/intelligence")).isEqualTo(1);
    }
}
