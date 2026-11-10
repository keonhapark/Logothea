package com.earningwhisperer.infrastructure.redis;

import com.earningwhisperer.domain.guest.GuestIssueLimiter;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

/** 고정 1분 창 카운터. 창 경계에서 최대 두 배까지 허용되지만 남용 방지 용도로는 충분하다. */
@Component
@RequiredArgsConstructor
public class RedisGuestIssueLimiter implements GuestIssueLimiter {

    private static final Duration KEY_TTL = Duration.ofMinutes(2);

    private final StringRedisTemplate redisTemplate;
    private Clock clock = Clock.systemUTC();

    void setClock(Clock clock) {
        this.clock = clock;
    }

    @Override
    public boolean tryAcquire(String clientIp, int perMinute) {
        long minute = clock.millis() / 60_000L;
        String key = "guest:issue:" + minute + ":" + clientIp;
        Long count = redisTemplate.opsForValue().increment(key);
        if (count == null) {
            return false;
        }
        if (count == 1L) {
            redisTemplate.expire(key, KEY_TTL);
        }
        return count <= perMinute;
    }
}
