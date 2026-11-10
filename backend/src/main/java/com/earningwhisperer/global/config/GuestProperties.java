package com.earningwhisperer.global.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 전시용 웹 게스트 설정.
 *
 * @param enabled             게스트 토큰 발급 여부. 꺼져 있으면 발급 API 가 404 를 준다
 * @param tokenTtlSeconds     게스트 토큰 수명. 만료되면 웹이 발급 API 를 다시 부른다
 * @param issuePerMinute      클라이언트 IP 하나가 1분에 받을 수 있는 토큰 수. 전시장은 관람객이 같은 IP 를 쓸 수 있다
 * @param assistantPerGuest   게스트 토큰 하나로 할 수 있는 질의응답 수
 * @param assistantDailyTotal 모든 게스트를 합친 하루 질의응답 수(LLM 비용 상한)
 */
@ConfigurationProperties(prefix = "app.guest")
public record GuestProperties(boolean enabled, int tokenTtlSeconds, int issuePerMinute,
                              int assistantPerGuest, int assistantDailyTotal) {

    public GuestProperties {
        if (tokenTtlSeconds <= 0) {
            tokenTtlSeconds = 3600;
        }
        if (issuePerMinute <= 0) {
            issuePerMinute = 20;
        }
        if (assistantPerGuest <= 0) {
            assistantPerGuest = 5;
        }
        if (assistantDailyTotal <= 0) {
            assistantDailyTotal = 500;
        }
    }
}
