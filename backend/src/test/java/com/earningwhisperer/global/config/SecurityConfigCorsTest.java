package com.earningwhisperer.global.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("SecurityConfig CORS 출처별 설정")
class SecurityConfigCorsTest {

    private CorsConfigurationSource source(String guestOrigins) {
        SecurityConfig config = new SecurityConfig(null, null, null);
        ReflectionTestUtils.setField(config, "allowedOriginsRaw", "http://localhost:3000,http://localhost:5173");
        ReflectionTestUtils.setField(config, "guestOriginsRaw", guestOrigins);
        return config.corsConfigurationSource();
    }

    private CorsConfiguration resolve(CorsConfigurationSource source, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/glossary");
        request.addHeader("Origin", origin);
        return source.getCorsConfiguration(request);
    }

    @Test
    @DisplayName("전시 웹 출처는 쿠키 없는 CORS 를 받는다")
    void guestOriginWithoutCredentials() {
        CorsConfiguration config = resolve(source("https://demo.logothea.com"), "https://demo.logothea.com");

        assertThat(config.checkOrigin("https://demo.logothea.com")).isEqualTo("https://demo.logothea.com");
        assertThat(config.getAllowCredentials()).isFalse();
        assertThat(config.getAllowedMethods()).doesNotContain("PUT", "DELETE");
    }

    @Test
    @DisplayName("로그인 웹 출처는 지금처럼 쿠키 포함 CORS 를 받는다")
    void credentialedOrigin() {
        CorsConfiguration config = resolve(source("https://demo.logothea.com"), "http://localhost:3000");

        assertThat(config.getAllowCredentials()).isTrue();
        assertThat(config.checkOrigin("http://localhost:3000")).isNotNull();
        assertThat(config.checkOrigin("https://demo.logothea.com")).isNull();
    }

    @Test
    @DisplayName("게스트 출처를 비워 두면 전시 웹 출처는 허용되지 않는다")
    void guestOriginsEmpty() {
        CorsConfiguration config = resolve(source(""), "https://demo.logothea.com");

        assertThat(config.checkOrigin("https://demo.logothea.com")).isNull();
    }
}
