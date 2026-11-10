package com.earningwhisperer.global.config;

import com.earningwhisperer.infrastructure.websocket.StompJwtChannelInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket STOMP 설정.
 *
 * - 클라이언트 연결 엔드포인트: /ws (SockJS 폴백 지원)
 * - 메시지 브로커 prefix: /topic (Public 브로드캐스트), /queue (Private 라우팅)
 * - 앱 목적지 prefix: /app (클라이언트 → 서버 메시지 전송용, 현재 미사용)
 *
 * 구독 예시:
 *   Public  → stompClient.subscribe('/topic/live/NVDA', handler)
 *
 * heart-beat 는 양방향 10초로 협상한다. 끄면(0,0) 모바일에서 망이 바뀐 뒤 닫힘 이벤트 없이 죽은
 * 소켓을 클라이언트가 알아채지 못한다. 터미널과 웹 클라이언트도 10초를 요청한다.
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    static final long HEARTBEAT_MILLIS = 10_000;

    private final StompJwtChannelInterceptor stompJwtChannelInterceptor;

    private TaskScheduler messageBrokerTaskScheduler;

    /**
     * heart-beat 전송에 쓰는 브로커 스케줄러. 이 설정 클래스가 브로커 설정보다 먼저 만들어지므로 @Lazy 로 받는다.
     * {@code @Scheduled} 작업은 {@link SchedulingConfig} 의 별도 풀에서 돌아 이 풀을 막지 않는다.
     */
    @Autowired
    public void setMessageBrokerTaskScheduler(@Lazy @Qualifier("messageBrokerTaskScheduler") TaskScheduler taskScheduler) {
        this.messageBrokerTaskScheduler = taskScheduler;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[]{HEARTBEAT_MILLIS, HEARTBEAT_MILLIS})
                .setTaskScheduler(messageBrokerTaskScheduler);
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // 브라우저 클라이언트용 (SockJS 폴백)
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();

        // Trading Terminal용 (native WebSocket, ws 패키지)
        registry.addEndpoint("/ws-native")
                .setAllowedOriginPatterns("*");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompJwtChannelInterceptor);
    }
}
