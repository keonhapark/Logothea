package com.earningwhisperer.presentation.assistant;

import com.earningwhisperer.domain.assistant.AssistantAskException;
import com.earningwhisperer.domain.assistant.AssistantAskService;
import com.earningwhisperer.domain.assistant.AssistantAskService.PreparedAsk;
import com.earningwhisperer.domain.assistant.AssistantQuota;
import com.earningwhisperer.global.config.AssistantProperties;
import com.earningwhisperer.global.config.GuestProperties;
import com.earningwhisperer.infrastructure.security.GuestPrincipal;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.RejectedExecutionException;

/**
 * 어닝콜 질의응답 외부 진입점 (#112, api-spec 7.10).
 *
 * <p>순서: 요청 검증 → 질문 시점 확정(세그먼트 없음 404·종목 불일치 400) → 동시 질문 잠금(409) → 하루 횟수 차감(429)
 * → 중계 시작. 404·400·409 는 횟수를 쓰지 않는다. 오류 응답은 Content-Type 을 명시해, 터미널이
 * {@code Accept: text/event-stream} 을 함께 보내도 406 으로 바뀌지 않게 한다.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/assistant")
public class AssistantController {

    private static final ZoneId QUOTA_ZONE = ZoneId.of("Asia/Seoul");
    // 중계가 비정상 종료해도 잠금이 영구히 남지 않도록, 스트림 상한보다 조금 길게 둔다.
    private static final Duration LOCK_MARGIN = Duration.ofSeconds(10);

    /** 모든 게스트를 합친 하루 횟수를 세는 키. 사용자 ID(숫자) · 게스트 키(guest:)와 겹치지 않는다. */
    static final String GUEST_TOTAL_KEY = "guest-total";

    private final AssistantAskService askService;
    private final AssistantQuota quota;
    private final AssistantRelay relay;
    private final AssistantProperties properties;
    private final GuestProperties guestProperties;

    public AssistantController(AssistantAskService askService, AssistantQuota quota, AssistantRelay relay,
                               AssistantProperties properties, GuestProperties guestProperties) {
        this.askService = askService;
        this.quota = quota;
        this.relay = relay;
        this.properties = properties;
        this.guestProperties = guestProperties;
    }

    // 반환 타입을 Object 로 두는 이유: ResponseEntity<?> 는 제네릭이 풀리지 않아 SseEmitter 가 비동기 핸들러가 아닌
    // 메시지 컨버터로 넘어가 스트림이 시작되지 않는다. 성공은 SseEmitter(Content-Type 은 emitter 가 text/event-stream 으로 지정),
    // 실패는 ResponseEntity 로 반환한다.
    @PostMapping("/ask")
    public Object ask(@Valid @RequestBody AssistantAskRequest body, Authentication authentication) {
        Object principal = authentication.getPrincipal();
        boolean guest = principal instanceof GuestPrincipal;
        String userId = guest ? ((GuestPrincipal) principal).key() : String.valueOf((Long) principal);
        PreparedAsk prepared;
        try {
            prepared = askService.prepare(body.toCommand(userId));
        } catch (AssistantAskException e) {
            return switch (e.getReason()) {
                case SEGMENTS_NOT_FOUND -> error(HttpStatus.NOT_FOUND, "segments_not_found", "이 콜의 자막을 찾지 못했습니다.");
                case TICKER_MISMATCH -> error(HttpStatus.BAD_REQUEST, "ticker_mismatch", "콜과 종목이 일치하지 않습니다.");
            };
        } catch (DataAccessException e) {
            // 세그먼트 저장소(Redis) 장애. "자막 없음"(404)과 구분해 503 으로 알린다.
            log.warn("질의응답 세그먼트 조회 실패 user_id={}", userId, e);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "assistant_unavailable", "질의응답을 잠시 사용할 수 없습니다.");
        }
        // 잠금을 잡은 뒤 중계가 소유권을 넘겨받기 전에 어떤 이유로든 빠져나가면 여기서 푼다.
        // RejectedExecutionException 은 중계가 이미 잠금을 풀었으므로 다시 풀지 않는다.
        boolean locked = false;
        boolean released = false;
        try {
            Duration lockTtl = Duration.ofSeconds(properties.streamTimeoutSeconds()).plus(LOCK_MARGIN);
            if (!quota.tryLock(userId, lockTtl)) {
                return error(HttpStatus.CONFLICT, "assistant_busy", "이전 질문의 답변이 끝난 뒤 다시 질문해 주세요.");
            }
            locked = true;
            LocalDate today = LocalDate.now(QUOTA_ZONE);
            if (!consumeDaily(userId, guest, today)) {
                Map<String, Object> payload = body("daily_limit_exceeded", "오늘 질문 횟수를 모두 썼습니다.");
                payload.put("reset_at", today.plusDays(1).atStartOfDay(QUOTA_ZONE).toInstant().toString());
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).contentType(MediaType.APPLICATION_JSON).body(payload);
            }
            SseEmitter emitter = relay.start(prepared);
            released = true; // 중계가 소유권을 넘겨받았다.
            return emitter;
        } catch (RejectedExecutionException e) {
            released = true; // 중계가 이미 잠금을 풀었다.
            log.warn("질의응답 중계 스레드가 가득 찼습니다 user_id={}", userId);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "assistant_overloaded", "질문이 몰려 있습니다. 잠시 후 다시 질문해 주세요.");
        } catch (DataAccessException e) {
            log.warn("질의응답 한도 확인 실패 user_id={}", userId, e);
            return error(HttpStatus.SERVICE_UNAVAILABLE, "assistant_unavailable", "질의응답을 잠시 사용할 수 없습니다.");
        } finally {
            if (locked && !released) {
                releaseQuietly(userId);
            }
        }
    }

    /**
     * 사용자는 하루 한도 하나, 게스트는 토큰 하나당 한도와 게스트 전체 하루 한도를 둘 다 통과해야 한다.
     * 게스트 토큰은 다시 받으면 새 식별자가 되므로 토큰당 한도만으로는 비용을 막지 못한다. 합산 한도가 실제 상한이다.
     * 게스트 토큰 수명이 하루보다 짧아 토큰당 한도도 날짜 키에 둔다.
     */
    private boolean consumeDaily(String userId, boolean guest, LocalDate today) {
        if (!guest) {
            return quota.tryConsumeDaily(userId, today, properties.dailyLimit());
        }
        return quota.tryConsumeDaily(userId, today, guestProperties.assistantPerGuest())
                && quota.tryConsumeDaily(GUEST_TOTAL_KEY, today, guestProperties.assistantDailyTotal());
    }

    private void releaseQuietly(String userId) {
        try {
            quota.unlock(userId);
        } catch (RuntimeException e) {
            log.warn("질의응답 잠금 해제 실패 user_id={}", userId, e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body(code, message));
    }

    private static Map<String, Object> body(String code, String message) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("error", message);
        payload.put("code", code);
        return payload;
    }
}
