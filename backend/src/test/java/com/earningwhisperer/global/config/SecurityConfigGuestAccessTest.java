package com.earningwhisperer.global.config;

import com.earningwhisperer.infrastructure.security.JwtProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 게스트 허용 목록. 실제 JwtProvider 로 만든 게스트 · 사용자 토큰으로 경로마다 인가 결과를 본다.
 * 컨트롤러는 같은 경로를 받는 프로브로 대신해, 시큐리티 규칙만 검증한다.
 */
@WebMvcTest(controllers = SecurityConfigGuestAccessTest.ProbeController.class)
@Import({
        SecurityConfig.class,
        com.earningwhisperer.infrastructure.security.InternalSecretFilter.class,
        SecurityConfigGuestAccessTest.TokenConfig.class,
        SecurityConfigGuestAccessTest.ProbeController.class,
})
@DisplayName("SecurityConfig 게스트 허용 목록")
class SecurityConfigGuestAccessTest {

    @RestController
    static class ProbeController {
        @RequestMapping({
                "/api/v1/glossary",
                "/api/v1/demo/earnings-call/status",
                "/api/v1/demo/earnings-call/speakers",
                "/api/v1/demo/earnings-call/start",
                "/api/v1/demo/earnings-call/stop",
                "/api/v1/earnings-calendar/terminal-timeline",
                "/api/v1/earnings-calendar",
                "/api/v1/stocks/{ticker}/detail",
                "/api/v1/assistant/ask",
                "/api/v1/trades",
                "/api/v1/trades/{id}",
                "/api/v1/portfolio",
                "/api/v1/watchlist",
                "/api/v1/users/me",
                "/api/v1/guest/token",
        })
        String probe() {
            return "ok";
        }
    }

    @TestConfiguration
    static class TokenConfig {
        @Bean
        GuestProperties guestProperties() {
            return new GuestProperties(true, 3600, 20, 5, 500);
        }

        @Bean
        JwtProvider jwtProvider() {
            return new JwtProvider("test-secret-key-minimum-32-characters-long", 3600_000L,
                    "test-issuer", "test-audience");
        }
    }

    @Autowired MockMvc mockMvc;
    @Autowired JwtProvider jwtProvider;

    @MockBean com.earningwhisperer.infrastructure.security.UserDetailsServiceImpl userDetailsService;

    private String guest() {
        return "Bearer " + jwtProvider.generateGuestToken("g1", Duration.ofMinutes(5));
    }

    private String user() {
        return "Bearer " + jwtProvider.generateToken(7L);
    }

    @ParameterizedTest(name = "게스트 {0} {1} → 200")
    @CsvSource({
            "GET, /api/v1/glossary",
            "GET, /api/v1/demo/earnings-call/status",
            "GET, /api/v1/demo/earnings-call/speakers",
            "GET, /api/v1/earnings-calendar/terminal-timeline",
            "GET, /api/v1/stocks/AAPL/detail",
            "POST, /api/v1/assistant/ask",
    })
    void guestAllowed(String method, String path) throws Exception {
        mockMvc.perform(request(HttpMethod.valueOf(method), path).header(HttpHeaders.AUTHORIZATION, guest()))
                .andExpect(status().isOk());
    }

    @ParameterizedTest(name = "게스트 {0} {1} → 403")
    @CsvSource({
            "POST, /api/v1/demo/earnings-call/start",
            "POST, /api/v1/demo/earnings-call/stop",
            "GET, /api/v1/earnings-calendar",
            "GET, /api/v1/trades",
            "POST, /api/v1/trades",
            "DELETE, /api/v1/trades/1",
            "GET, /api/v1/portfolio",
            "GET, /api/v1/watchlist",
            "GET, /api/v1/users/me",
            "POST, /api/v1/glossary",
            "GET, /api/v1/assistant/ask",
    })
    void guestDenied(String method, String path) throws Exception {
        mockMvc.perform(request(HttpMethod.valueOf(method), path).header(HttpHeaders.AUTHORIZATION, guest()))
                .andExpect(status().isForbidden());
    }

    @ParameterizedTest(name = "사용자 {0} {1} → 200")
    @CsvSource({
            "GET, /api/v1/glossary",
            "POST, /api/v1/assistant/ask",
            "POST, /api/v1/demo/earnings-call/start",
            "GET, /api/v1/trades",
            "GET, /api/v1/portfolio",
    })
    void userAllowed(String method, String path) throws Exception {
        mockMvc.perform(request(HttpMethod.valueOf(method), path).header(HttpHeaders.AUTHORIZATION, user()))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("토큰이 없으면 게스트 허용 경로도 401")
    void anonymousIsUnauthorized() throws Exception {
        mockMvc.perform(request(HttpMethod.GET, "/api/v1/glossary")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("게스트 토큰 발급은 토큰 없이 부를 수 있다")
    void guestTokenIsPublic() throws Exception {
        mockMvc.perform(request(HttpMethod.POST, "/api/v1/guest/token")).andExpect(status().isOk());
    }
}
