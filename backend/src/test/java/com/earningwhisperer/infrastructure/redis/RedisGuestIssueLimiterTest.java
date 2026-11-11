package com.earningwhisperer.infrastructure.redis;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("RedisGuestIssueLimiter")
class RedisGuestIssueLimiterTest {

    @Mock StringRedisTemplate redisTemplate;
    @Mock ValueOperations<String, String> valueOps;

    private RedisGuestIssueLimiter limiter;

    private static final Instant NOW = Instant.parse("2026-11-11T00:00:30Z");
    private static final String KEY = "guest:issue:" + (NOW.toEpochMilli() / 60_000L) + ":1.2.3.4";

    @BeforeEach
    void setUp() {
        limiter = new RedisGuestIssueLimiter(redisTemplate);
        limiter.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
    }

    @Test
    @DisplayName("창의 첫 발급이면 키에 TTL 을 걸고 허용한다")
    void firstInWindow() {
        when(valueOps.increment(KEY)).thenReturn(1L);

        assertThat(limiter.tryAcquire("1.2.3.4", 20)).isTrue();
        verify(redisTemplate).expire(KEY, Duration.ofMinutes(2));
    }

    @Test
    @DisplayName("한도와 같으면 허용, 넘으면 거부. TTL 은 다시 걸지 않는다")
    void overLimit() {
        when(valueOps.increment(KEY)).thenReturn(20L, 21L);

        assertThat(limiter.tryAcquire("1.2.3.4", 20)).isTrue();
        assertThat(limiter.tryAcquire("1.2.3.4", 20)).isFalse();
        verify(redisTemplate, never()).expire(anyString(), any(Duration.class));
    }

    @Test
    @DisplayName("Redis 가 null 을 주면 거부한다")
    void nullCount() {
        when(valueOps.increment(KEY)).thenReturn(null);

        assertThat(limiter.tryAcquire("1.2.3.4", 20)).isFalse();
    }
}
