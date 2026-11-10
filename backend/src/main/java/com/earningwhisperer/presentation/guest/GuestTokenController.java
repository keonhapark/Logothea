package com.earningwhisperer.presentation.guest;

import com.earningwhisperer.domain.guest.GuestIssueLimiter;
import com.earningwhisperer.global.config.GuestProperties;
import com.earningwhisperer.infrastructure.security.JwtProvider;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 전시용 웹 게스트 토큰 발급 (api-spec 7.1.1).
 *
 * <p>인증 없이 부르며, 응답은 {@code {access_token, expires_in}} 이다. 쿠키 · refresh token 은 쓰지 않는다.
 * 만료되면 웹이 다시 부른다. 게스트마다 users 행을 만들지 않고 토큰 안의 임의 식별자로 구분한다.
 *
 * <p>클라이언트 IP 는 {@code CF-Connecting-IP} 를 쓴다. 운영 backend 는 루프백에만 바인딩되고 Cloudflare Tunnel 로만
 * 들어오므로 이 헤더는 Cloudflare 가 채운 값이다. 헤더가 없으면(로컬) 소켓 주소를 쓴다.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/guest")
@RequiredArgsConstructor
public class GuestTokenController {

    static final String CLIENT_IP_HEADER = "CF-Connecting-IP";

    private final JwtProvider jwtProvider;
    private final GuestIssueLimiter issueLimiter;
    private final GuestProperties properties;

    @PostMapping("/token")
    public ResponseEntity<Map<String, Object>> issue(HttpServletRequest request) {
        if (!properties.enabled()) {
            return ResponseEntity.notFound().build();
        }
        String clientIp = clientIp(request);
        try {
            if (!issueLimiter.tryAcquire(clientIp, properties.issuePerMinute())) {
                return error(HttpStatus.TOO_MANY_REQUESTS, "guest_rate_limited", "잠시 후 다시 시도해 주세요.");
            }
        } catch (DataAccessException e) {
            log.warn("게스트 토큰 발급 한도 확인 실패", e);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "guest_unavailable", "잠시 후 다시 시도해 주세요.");
        }
        Duration ttl = Duration.ofSeconds(properties.tokenTtlSeconds());
        String token = jwtProvider.generateGuestToken(UUID.randomUUID().toString(), ttl);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("access_token", token);
        body.put("expires_in", ttl.toSeconds());
        return ResponseEntity.ok(body);
    }

    static String clientIp(HttpServletRequest request) {
        String header = request.getHeader(CLIENT_IP_HEADER);
        return StringUtils.hasText(header) ? header.trim() : request.getRemoteAddr();
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", message);
        body.put("code", code);
        return ResponseEntity.status(status).body(body);
    }
}
