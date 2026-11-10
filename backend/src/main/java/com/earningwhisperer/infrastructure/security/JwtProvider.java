package com.earningwhisperer.infrastructure.security;

import com.earningwhisperer.domain.user.TokenProvider;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.jsonwebtoken.Claims;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

/**
 * JWT 토큰 생성·검증·파싱 컴포넌트.
 *
 * domain/user/TokenProvider 인터페이스를 구현하여
 * AuthService가 infrastructure에 직접 의존하지 않도록 한다.
 *
 * 알고리즘: HMAC-SHA256 (HS256)
 * Payload subject: userId (Long → String)
 *
 * issuer/audience 클레임을 발행 시 박고 검증 시 require 한다.
 * 환경별로 다른 issuer 를 쓰면 dev/staging/prod 시크릿 공유 사고가 나도 토큰 교차 통용을 차단한다.
 *
 * <h2>게스트 토큰</h2>
 * 전시용 웹 관람객에게 주는 토큰이다. subject 는 {@code guest:{id}}, {@code role=guest} 클레임을 싣는다.
 * 사용자 토큰에는 role 클레임이 없으므로, role 이 있으면 사용자 ID 로 읽지 않는다
 * ({@link #getUserIdFromToken} 이 거부). 인증 지점은 {@link #getGuestIdFromToken} 을 먼저 보고 분기한다.
 */
@Slf4j
@Component
public class JwtProvider implements TokenProvider {

    /** 발행 시 박고 검증 시 require 하는 클레임. 환경별 분리는 issuer 만 환경변수로 외부화하면 된다. */
    public static final String DEFAULT_ISSUER = "earning-whisperer";
    public static final String DEFAULT_AUDIENCE = "earning-whisperer-api";

    private static final int MIN_SECRET_LENGTH = 32;

    static final String ROLE_CLAIM = "role";
    static final String GUEST_ROLE = "guest";
    static final String GUEST_SUBJECT_PREFIX = "guest:";

    private final SecretKey secretKey;
    private final long expirationMs;
    private final String issuer;
    private final String audience;

    public JwtProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.expiration-ms}") long expirationMs,
            @Value("${jwt.issuer:" + DEFAULT_ISSUER + "}") String issuer,
            @Value("${jwt.audience:" + DEFAULT_AUDIENCE + "}") String audience) {
        if (secret == null || secret.length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(
                    "jwt.secret 은 최소 " + MIN_SECRET_LENGTH + "자 이상이어야 합니다 (HS256 요구사항).");
        }
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
        this.issuer = issuer;
        this.audience = audience;
    }

    @Override
    public String generateToken(Long userId) {
        return Jwts.builder()
                .subject(userId.toString())
                .issuer(issuer)
                .audience().add(audience).and()
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationMs))
                .signWith(secretKey)
                .compact();
    }

    public boolean validateToken(String token) {
        try {
            parser().parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("[JwtProvider] 토큰 검증 실패: {}", e.getMessage());
            return false;
        }
    }

    public Long getUserIdFromToken(String token) {
        Claims claims = parser().parseSignedClaims(token).getPayload();
        if (claims.get(ROLE_CLAIM) != null) {
            // 게스트 토큰을 사용자 토큰으로 읽지 않는다. subject 가 숫자가 아니라 어차피 실패하지만 이유를 분명히 한다.
            throw new JwtException("role 클레임이 있는 토큰은 사용자 토큰이 아닙니다");
        }
        return Long.parseLong(claims.getSubject());
    }

    /** 게스트 토큰을 발급한다. guestId 는 호출자가 만든 임의 식별자다. */
    public String generateGuestToken(String guestId, Duration ttl) {
        Date now = new Date();
        return Jwts.builder()
                .subject(GUEST_SUBJECT_PREFIX + guestId)
                .claim(ROLE_CLAIM, GUEST_ROLE)
                .issuer(issuer)
                .audience().add(audience).and()
                .issuedAt(now)
                .expiration(new Date(now.getTime() + ttl.toMillis()))
                .signWith(secretKey)
                .compact();
    }

    /**
     * 유효한 게스트 토큰이면 게스트 식별자를, 사용자 토큰이면 빈 값을 돌려준다.
     * 서명 · 만료 · issuer · audience 검증은 {@link #validateToken} 과 같으며, 실패하면 예외를 던진다.
     */
    public Optional<String> getGuestIdFromToken(String token) {
        Claims claims = parser().parseSignedClaims(token).getPayload();
        if (!GUEST_ROLE.equals(claims.get(ROLE_CLAIM, String.class))) {
            return Optional.empty();
        }
        String subject = claims.getSubject();
        if (subject == null || !subject.startsWith(GUEST_SUBJECT_PREFIX)
                || subject.length() == GUEST_SUBJECT_PREFIX.length()) {
            throw new JwtException("게스트 토큰의 subject 형식이 아닙니다");
        }
        return Optional.of(subject.substring(GUEST_SUBJECT_PREFIX.length()));
    }

    @Override
    public String generateRefreshToken() {
        return UUID.randomUUID().toString();
    }

    private io.jsonwebtoken.JwtParser parser() {
        return Jwts.parser()
                .verifyWith(secretKey)
                .requireIssuer(issuer)
                .requireAudience(audience)
                .build();
    }
}
