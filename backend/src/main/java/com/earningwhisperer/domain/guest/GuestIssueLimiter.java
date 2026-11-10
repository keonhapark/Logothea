package com.earningwhisperer.domain.guest;

/** 게스트 토큰 발급 횟수 제한. 클라이언트 IP 단위로 1분 창을 센다. */
public interface GuestIssueLimiter {

    /** 이번 1분 창의 발급 횟수를 1 늘리고 한도 안이면 true. */
    boolean tryAcquire(String clientIp, int perMinute);
}
