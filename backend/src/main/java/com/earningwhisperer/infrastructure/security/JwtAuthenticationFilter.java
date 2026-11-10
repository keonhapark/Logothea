package com.earningwhisperer.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.function.BooleanSupplier;

/**
 * JWT 인증 필터.
 *
 * 요청마다 한 번 실행(OncePerRequestFilter).
 * Authorization 헤더에서 Bearer 토큰을 추출하고 검증한다.
 * 유효한 토큰이면 userId를 principal로 하는 Authentication을 SecurityContext에 설정한다.
 * 게스트 토큰이면 {@link GuestPrincipal} 과 ROLE_GUEST 를 설정한다.
 *
 * 컨트롤러에서 userId 추출:
 *   Long userId = (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
 *   또는 메서드 파라미터 Authentication을 주입받아 (Long) auth.getPrincipal()
 */
@Slf4j
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    public static final String ROLE_USER = "ROLE_USER";

    private final JwtProvider jwtProvider;
    /** 게스트 발급이 꺼져 있으면 이미 나간 게스트 토큰도 받지 않는다. 재시작 없이 끊을 수 있게 매 요청 본다. */
    private final BooleanSupplier guestEnabled;

    public JwtAuthenticationFilter(JwtProvider jwtProvider) {
        this(jwtProvider, () -> false);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String token = extractToken(request);

        if (token != null && jwtProvider.validateToken(token)) {
            try {
                UsernamePasswordAuthenticationToken auth = authenticate(token);
                if (auth != null) {
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (RuntimeException e) {
                // 서명은 맞지만 형식이 어긋난 토큰. 500 대신 인증 없음(401)으로 둔다.
                log.debug("[JwtFilter] 토큰 내용을 읽지 못해 인증하지 않는다: {}", e.getMessage());
            }
        }

        filterChain.doFilter(request, response);
    }

    /** 게스트 토큰은 {@link GuestPrincipal} + ROLE_GUEST, 사용자 토큰은 Long userId + ROLE_USER. 게스트가 꺼져 있으면 null. */
    private UsernamePasswordAuthenticationToken authenticate(String token) {
        Optional<String> guestId = jwtProvider.getGuestIdFromToken(token);
        if (guestId.isPresent()) {
            if (!guestEnabled.getAsBoolean()) {
                return null;
            }
            return new UsernamePasswordAuthenticationToken(
                    new GuestPrincipal(guestId.get()), null, List.of(new SimpleGrantedAuthority(GuestPrincipal.ROLE)));
        }
        Long userId = jwtProvider.getUserIdFromToken(token);
        return new UsernamePasswordAuthenticationToken(
                userId, null, List.of(new SimpleGrantedAuthority(ROLE_USER)));
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
