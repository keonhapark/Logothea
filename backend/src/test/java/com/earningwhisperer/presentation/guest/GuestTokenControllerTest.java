package com.earningwhisperer.presentation.guest;

import com.earningwhisperer.domain.guest.GuestIssueLimiter;
import com.earningwhisperer.global.config.GuestProperties;
import com.earningwhisperer.infrastructure.security.JwtProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@DisplayName("GuestTokenController")
class GuestTokenControllerTest {

    private final JwtProvider jwtProvider = new JwtProvider("test-secret-key-minimum-32-characters-long", 3600_000L,
            "test-issuer", "test-audience");
    private final GuestIssueLimiter limiter = mock(GuestIssueLimiter.class);

    private GuestTokenController controller(boolean enabled) {
        return new GuestTokenController(jwtProvider, limiter, new GuestProperties(enabled, 1800, 20, 5, 500));
    }

    private MockHttpServletRequest request(String cfIp) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/guest/token");
        request.setRemoteAddr("127.0.0.1");
        if (cfIp != null) {
            request.addHeader("CF-Connecting-IP", cfIp);
        }
        return request;
    }

    @Test
    @DisplayName("꺼져 있으면 404, 한도도 세지 않는다")
    void disabled() {
        ResponseEntity<Map<String, Object>> response = controller(false).issue(request("1.2.3.4"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        verifyNoInteractions(limiter);
    }

    @Test
    @DisplayName("발급한 토큰은 게스트 토큰이고 expires_in 은 설정값이다. 한도는 CF-Connecting-IP 로 센다")
    void issuesGuestToken() {
        when(limiter.tryAcquire("1.2.3.4", 20)).thenReturn(true);

        ResponseEntity<Map<String, Object>> response = controller(true).issue(request("1.2.3.4"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String token = (String) response.getBody().get("access_token");
        assertThat(jwtProvider.getGuestIdFromToken(token)).isPresent();
        assertThat(response.getBody().get("expires_in")).isEqualTo(1800L);
    }

    @Test
    @DisplayName("토큰마다 게스트 식별자가 다르다")
    void distinctGuestIds() {
        when(limiter.tryAcquire(anyString(), anyInt())).thenReturn(true);
        GuestTokenController controller = controller(true);

        String a = (String) controller.issue(request("1.2.3.4")).getBody().get("access_token");
        String b = (String) controller.issue(request("1.2.3.4")).getBody().get("access_token");

        assertThat(jwtProvider.getGuestIdFromToken(a)).isNotEqualTo(jwtProvider.getGuestIdFromToken(b));
    }

    @Test
    @DisplayName("헤더가 없으면 소켓 주소로 센다")
    void fallsBackToRemoteAddr() {
        when(limiter.tryAcquire("127.0.0.1", 20)).thenReturn(true);

        controller(true).issue(request(null));

        verify(limiter).tryAcquire("127.0.0.1", 20);
    }

    @Test
    @DisplayName("한도를 넘으면 429 guest_rate_limited")
    void rateLimited() {
        when(limiter.tryAcquire("1.2.3.4", 20)).thenReturn(false);

        ResponseEntity<Map<String, Object>> response = controller(true).issue(request("1.2.3.4"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getBody()).containsEntry("code", "guest_rate_limited").doesNotContainKey("access_token");
    }

    @Test
    @DisplayName("Redis 장애면 503 이고 토큰을 주지 않는다")
    void redisDown() {
        when(limiter.tryAcquire(anyString(), anyInt())).thenThrow(new QueryTimeoutException("down"));

        ResponseEntity<Map<String, Object>> response = controller(true).issue(request("1.2.3.4"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).doesNotContainKey("access_token");
    }
}
