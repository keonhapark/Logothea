package com.earningwhisperer.presentation.assistant;

import com.earningwhisperer.domain.assistant.AssistantAskService;
import com.earningwhisperer.domain.assistant.AssistantQuota;
import com.earningwhisperer.domain.transcript.TranscriptSegment;
import com.earningwhisperer.domain.transcript.TranscriptSegmentStore;
import com.earningwhisperer.global.config.AssistantConfig;
import com.earningwhisperer.global.config.SecurityConfig;
import com.earningwhisperer.infrastructure.assistant.AssistantStreamClient;
import com.earningwhisperer.infrastructure.security.InternalSecretFilter;
import com.earningwhisperer.infrastructure.security.JwtProvider;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration;
import org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real servlet -> production relay/client -> loopback fake assistant. No providers or Redis. */
@SpringBootTest(classes = AssistantHttpFlowTest.Config.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "app.internal.secret=local-test-secret")
class AssistantHttpFlowTest {
    @Configuration
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class,
            RedisAutoConfiguration.class, RedisRepositoriesAutoConfiguration.class})
    @Import({AssistantController.class, AssistantAskService.class, AssistantRelay.class, AssistantStreamClient.class,
            AssistantConfig.class, SecurityConfig.class, InternalSecretFilter.class})
    static class Config {}

    static final AtomicReference<String> forwarded = new AtomicReference<>();
    static final AtomicReference<String> secret = new AtomicReference<>();
    static HttpServer assistant;
    @LocalServerPort int port;
    @MockBean TranscriptSegmentStore segments;
    @MockBean AssistantQuota quota;
    @MockBean JwtProvider jwt;

    @DynamicPropertySource
    static void upstream(DynamicPropertyRegistry registry) throws Exception {
        assistant = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        assistant.createContext("/v1/assistant/ask", exchange -> {
            forwarded.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            secret.set(exchange.getRequestHeaders().getFirst("X-Internal-Secret"));
            byte[] data = ("event: delta\ndata: {\"text\":\"매출이 늘었습니다\"}\n\n"
                    + "event: done\ndata: {\"status\":\"answered\"}\n\n").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, data.length);
            try (var out = exchange.getResponseBody()) { out.write(data); }
        });
        assistant.start();
        registry.add("app.assistant.base-url", () -> "http://127.0.0.1:" + assistant.getAddress().getPort());
    }
    @AfterAll static void stop() { if (assistant != null) assistant.stop(0); }
    @BeforeEach void setup() {
        when(jwt.validateToken("local-token")).thenReturn(true);
        when(jwt.getUserIdFromToken("local-token")).thenReturn(7L);
        when(segments.findUntil("call-local", 99)).thenReturn(List.of(
                new TranscriptSegment("WMT", "call-local", 3, 0, 6000, "Revenue rose.", null, 1787227200L, false)));
        when(quota.tryLock(eq(7L), any())).thenReturn(true);
        when(quota.tryConsumeDaily(eq(7L), any(), anyInt())).thenReturn(true);
    }
    HttpResponse<String> ask(boolean authenticated) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/assistant/ask"))
                .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
                .header("Accept", "text/event-stream, application/json");
        if (authenticated) request.header("Authorization", "Bearer local-token");
        return HttpClient.newHttpClient().send(request.POST(HttpRequest.BodyPublishers.ofString(
                "{\"ticker\":\"WMT\",\"call_id\":\"call-local\",\"as_of_sequence\":99,\"anchor_sequence\":3,\"question\":\"매출은?\",\"history\":[]}"))
                .build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }
    @Test void authenticatedFlowPreservesSseAndServerTimeBoundary() throws Exception {
        var response = ask(true);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("text/event-stream");
        assertThat(response.body()).contains("event:delta", "매출이 늘었습니다", "event:done", "answered");
        var body = new ObjectMapper().readTree(forwarded.get());
        assertThat(body.path("as_of_sequence").asInt()).isEqualTo(3);
        assertThat(body.path("as_of_epoch").asLong()).isEqualTo(1787227200L);
        assertThat(body.path("call_ended").asBoolean()).isFalse();
        assertThat(secret.get()).isEqualTo("local-test-secret");
        verify(quota, timeout(2000)).unlock(7L);
    }
    @Test void unauthenticatedRequestDoesNotReachQuotaOrUpstream() throws Exception {
        assertThat(ask(false).statusCode()).isEqualTo(401);
        verifyNoInteractions(quota, segments);
    }
}
