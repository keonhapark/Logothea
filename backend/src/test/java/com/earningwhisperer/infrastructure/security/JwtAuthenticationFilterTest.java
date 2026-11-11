package com.earningwhisperer.infrastructure.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("JwtAuthenticationFilter")
class JwtAuthenticationFilterTest {

    private final JwtProvider jwtProvider = new JwtProvider("test-secret-key-minimum-32-characters-long", 3600_000L,
            "test-issuer", "test-audience");

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private Authentication run(JwtAuthenticationFilter filter, String token) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/glossary");
        request.addHeader("Authorization", "Bearer " + token);
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        return SecurityContextHolder.getContext().getAuthentication();
    }

    @Test
    @DisplayName("게스트가 켜져 있으면 게스트 토큰은 GuestPrincipal + ROLE_GUEST")
    void guestEnabled() throws Exception {
        String token = jwtProvider.generateGuestToken("g1", Duration.ofMinutes(5));

        Authentication auth = run(new JwtAuthenticationFilter(jwtProvider, () -> true), token);

        assertThat(auth.getPrincipal()).isEqualTo(new GuestPrincipal("g1"));
        assertThat(auth.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_GUEST");
    }

    @Test
    @DisplayName("게스트가 꺼져 있으면 이미 나간 게스트 토큰도 인증하지 않는다")
    void guestDisabled() throws Exception {
        String token = jwtProvider.generateGuestToken("g1", Duration.ofMinutes(5));

        assertThat(run(new JwtAuthenticationFilter(jwtProvider, () -> false), token)).isNull();
    }

    @Test
    @DisplayName("사용자 토큰은 게스트 설정과 무관하게 Long userId + ROLE_USER")
    void userToken() throws Exception {
        Authentication auth = run(new JwtAuthenticationFilter(jwtProvider, () -> false), jwtProvider.generateToken(7L));

        assertThat(auth.getPrincipal()).isEqualTo(7L);
        assertThat(auth.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_USER");
    }

    @Test
    @DisplayName("서명은 맞지만 내용을 읽지 못하는 토큰은 500 대신 인증 없음으로 둔다")
    void malformedContentIsUnauthenticated() throws Exception {
        JwtProvider broken = mock(JwtProvider.class);
        when(broken.validateToken("t")).thenReturn(true);
        when(broken.getGuestIdFromToken("t")).thenThrow(new io.jsonwebtoken.JwtException("bad subject"));

        assertThat(run(new JwtAuthenticationFilter(broken, () -> true), "t")).isNull();
    }
}
