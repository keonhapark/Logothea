package com.earningwhisperer.global.config;

import com.earningwhisperer.infrastructure.security.InternalSecretFilter;
import com.earningwhisperer.infrastructure.security.JwtAuthenticationFilter;
import com.earningwhisperer.infrastructure.security.JsonAccessDeniedHandler;
import com.earningwhisperer.infrastructure.security.JsonAuthenticationEntryPoint;
import com.earningwhisperer.infrastructure.security.JwtProvider;
import jakarta.servlet.DispatcherType;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Spring Security 설정.
 *
 * - Stateless 세션 (JWT 기반 인증)
 * - JwtAuthenticationFilter: 요청마다 Bearer 토큰 검증 후 SecurityContext에 userId 저장
 * - 공개 엔드포인트: /api/v1/auth/**, /api/v1/guest/token, /ws/**, /actuator/health
 * - 게스트(ROLE_GUEST) 허용 목록: {@link #GUEST_GET_PATHS}, {@link #GUEST_POST_PATHS}
 * - 나머지 모든 요청: 로그인 사용자(ROLE_USER)만
 *
 * 게스트 권한은 허용 목록 방식이다. 새 API 가 생겨도 게스트에게는 조용히 열리지 않는다.
 */
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    /** 전시용 웹 관람객이 읽기만 하는 경로. 주문 · 계좌 · 관심종목 · 사용자 · 시연 제어는 넣지 않는다. */
    static final String[] GUEST_GET_PATHS = {
            "/api/v1/glossary",
            "/api/v1/demo/earnings-call/status",
            "/api/v1/demo/earnings-call/speakers",
            "/api/v1/earnings-calendar/terminal-timeline",
            "/api/v1/stocks/*/detail",
    };

    /** 게스트가 쓸 수 있는 쓰기 경로. 질의응답은 게스트 전용 한도가 따로 걸린다(AssistantController). */
    static final String[] GUEST_POST_PATHS = {
            "/api/v1/assistant/ask",
    };

    private final JwtProvider jwtProvider;
    private final InternalSecretFilter internalSecretFilter;
    /** 게스트 설정이 없는 슬라이스 테스트에서도 뜨도록 선택 주입한다. 없으면 게스트를 받지 않는다. */
    private final ObjectProvider<GuestProperties> guestProperties;

    @Value("${app.cors.allowed-origins:http://localhost:3000,http://localhost:5173}")
    private String allowedOriginsRaw;

    /** 쿠키 없이 Bearer 토큰만 쓰는 출처(전시용 웹). 쿠키 포함 CORS 를 주지 않는다. */
    @Value("${app.cors.guest-origins:}")
    private String guestOriginsRaw;


    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // SSE(질의응답) 응답이 끝날 때의 ASYNC 디스패치는 최초 요청에서 이미 인가됐다.
                // JWT 필터는 ASYNC 디스패치를 건너뛰어 인증이 비어 있으므로, 여기서 막으면 답이 다 나간 뒤 인가 오류가 난다.
                .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/guest/token").permitAll()
                .requestMatchers("/api/v1/market/indices", "/api/v1/market/indices/**").permitAll()
                .requestMatchers("/api/v1/stocks/sp500", "/api/v1/stocks/prices").permitAll()
                .requestMatchers("/ws/**", "/ws-native/**").permitAll()
                .requestMatchers("/actuator/health").permitAll()
                // /api/v1/internal/** 는 InternalSecretFilter 가 X-Internal-Secret 으로 검증한다.
                // Spring Security 단계에서는 인증 객체 없이 통과시키고, 시크릿 검증은 필터가 책임진다.
                .requestMatchers("/api/v1/internal/**").permitAll()
                .requestMatchers("/api/v1/dev/**").permitAll()
                .requestMatchers(HttpMethod.GET, GUEST_GET_PATHS).hasAnyRole("USER", "GUEST")
                .requestMatchers(HttpMethod.POST, GUEST_POST_PATHS).hasAnyRole("USER", "GUEST")
                // 그 밖은 로그인 사용자만. 게스트는 403, 인증 없음은 401.
                .anyRequest().hasRole("USER"))
            .exceptionHandling(ex -> ex
                    // 기본값(Http403ForbiddenEntryPoint)은 인증이 없는 요청에도 403 을 준다.
                    // 그러면 클라이언트가 "토큰이 만료됐다" 와 "권한이 없다" 를 구분할 수 없고,
                    // 401 에서 토큰을 갱신하도록 만들어 둔 재시도 로직이 아예 돌지 않는다
                    // (터미널·웹 프론트 양쪽 모두 401 만 본다). 인증 실패는 401 로 돌려준다.
                    .authenticationEntryPoint(new JsonAuthenticationEntryPoint())
                    .accessDeniedHandler(new JsonAccessDeniedHandler()))
            .addFilterBefore(
                internalSecretFilter,
                UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(
                new JwtAuthenticationFilter(jwtProvider, guestEnabled()),
                UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    private java.util.function.BooleanSupplier guestEnabled() {
        return () -> {
            GuestProperties props = guestProperties.getIfAvailable();
            return props != null && props.enabled();
        };
    }

    /**
     * 출처에 따라 CORS 설정을 고른다.
     *
     * <ul>
     *   <li>{@code app.cors.guest-origins}(전시용 웹): 쿠키 없이 Bearer 토큰만. {@code allowCredentials=false}.
     *       api 와 같은 사이트라 refresh 쿠키의 SameSite 가 막아 주지 못하므로, 이 출처의 스크립트가 쿠키로
     *       {@code /auth/refresh} 를 불러 로그인 사용자의 토큰을 읽지 못하게 한다.</li>
     *   <li>{@code app.cors.allowed-origins}: 로그인 웹. refresh 쿠키를 쓰므로 {@code allowCredentials=true}.</li>
     * </ul>
     * 게스트 출처를 먼저 본다. 같은 출처가 양쪽에 있으면 쿠키 없는 쪽이 적용된다.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        // 콤마 분리. 와일드카드 패턴(*) 도 허용하므로 setAllowedOriginPatterns 사용. 운영은 좁게 주입한다.
        CorsConfiguration credentialed = corsConfig(parseOrigins(allowedOriginsRaw), true,
                List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        List<String> guestOrigins = parseOrigins(guestOriginsRaw);
        CorsConfiguration guest = guestOrigins.isEmpty() ? null
                : corsConfig(guestOrigins, false, List.of("GET", "POST", "OPTIONS"));

        UrlBasedCorsConfigurationSource fallback = new UrlBasedCorsConfigurationSource();
        fallback.registerCorsConfiguration("/**", credentialed);
        return request -> {
            String origin = request.getHeader(HttpHeaders.ORIGIN);
            if (guest != null && origin != null && guest.checkOrigin(origin) != null) {
                return guest;
            }
            return fallback.getCorsConfiguration(request);
        };
    }

    private static List<String> parseOrigins(String raw) {
        if (raw == null) {
            return List.of();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    private static CorsConfiguration corsConfig(List<String> origins, boolean allowCredentials, List<String> methods) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(origins);
        config.setAllowedMethods(methods);
        config.setAllowedHeaders(List.of("*"));
        // refresh_token 은 HttpOnly 쿠키로만 전송하므로 응답 헤더에 노출하지 않는다.
        config.setAllowCredentials(allowCredentials);
        return config;
    }
}
