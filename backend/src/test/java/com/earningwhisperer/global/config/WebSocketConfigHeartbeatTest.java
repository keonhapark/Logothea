package com.earningwhisperer.global.config;

import com.earningwhisperer.infrastructure.websocket.StompJwtChannelInterceptor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.messaging.simp.broker.SimpleBrokerMessageHandler;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * STOMP heart-beat 와 {@code @Scheduled} 풀 분리를 실제 Spring 설정으로 확인한다.
 * 운영과 같이 {@code @EnableScheduling} 과 브로커 설정을 함께 올린다.
 */
@SpringJUnitWebConfig(WebSocketConfigHeartbeatTest.TestConfig.class)
@DisplayName("WebSocketConfig STOMP heart-beat · @Scheduled 풀 분리")
class WebSocketConfigHeartbeatTest {

    @Configuration
    @EnableScheduling
    @Import({WebSocketConfig.class, SchedulingConfig.class})
    static class TestConfig {
        @Bean
        StompJwtChannelInterceptor stompJwtChannelInterceptor() {
            return mock(StompJwtChannelInterceptor.class);
        }

        @Bean
        ThreadProbe threadProbe() {
            return new ThreadProbe();
        }
    }

    static class ThreadProbe {
        final CompletableFuture<String> threadName = new CompletableFuture<>();

        @Scheduled(fixedDelay = 50)
        void record() {
            threadName.complete(Thread.currentThread().getName());
        }
    }

    @Autowired
    SimpleBrokerMessageHandler simpleBrokerMessageHandler;

    @Autowired
    ThreadProbe threadProbe;

    @Test
    @DisplayName("브로커가 양방향 10초 heart-beat 를 브로커 스케줄러로 보낸다")
    void brokerNegotiatesTenSecondHeartbeat() throws Exception {
        assertThat(simpleBrokerMessageHandler.getHeartbeatValue()).containsExactly(10_000L, 10_000L);
        // 주입은 @Lazy 프록시라 객체 비교 대신 실제로 브로커 스레드에서 실행되는지 본다.
        CompletableFuture<String> heartbeatThread = new CompletableFuture<>();
        simpleBrokerMessageHandler.getTaskScheduler()
                .schedule(() -> heartbeatThread.complete(Thread.currentThread().getName()), java.time.Instant.now());
        assertThat(heartbeatThread.get(5, TimeUnit.SECONDS)).startsWith("MessageBroker");
    }

    @Test
    @DisplayName("@Scheduled 작업은 브로커 풀이 아닌 전용 풀에서 돈다")
    void scheduledJobsRunOutsideBrokerPool() throws Exception {
        String name = threadProbe.threadName.get(5, TimeUnit.SECONDS);
        assertThat(name).startsWith(SchedulingConfig.THREAD_NAME_PREFIX).doesNotStartWith("MessageBroker");
    }
}
