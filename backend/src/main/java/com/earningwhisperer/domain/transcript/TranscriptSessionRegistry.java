package com.earningwhisperer.domain.transcript;

import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 어닝콜 세션별 시퀀스 단조성 / 종료 여부를 추적하는 인메모리 레지스트리.
 *
 * <p>역할 (Contract 6.4 검증 책임):
 * <ul>
 *   <li>같은 callId 안에서 새로운 sequence 단조 증가 보장</li>
 *   <li>이미 받은 동일 페이로드는 종료 후에도 중복으로 확인하고, 같은 sequence의 다른 내용은 거부</li>
 *   <li>{@code is_session_end=true} 한 번 수신된 callId의 새로운 인입은 거부 (409 신호)</li>
 *   <li>callId 간 격리 — 한 콜의 상태가 다른 콜에 영향을 주지 않는다.</li>
 * </ul>
 *
 * <p>동시성: callId별 {@link SessionState} 객체에 한해 synchronized 블록을 사용하여
 * 동일 callId 동시 인입을 직렬화하고, 서로 다른 callId 간에는 락을 공유하지 않는다.
 * 신규 SessionState 는 {@link ConcurrentHashMap#computeIfAbsent}로 원자적으로 생성한다.
 *
 * <p>TODO(미정): TTL/evict 정책 미적용 상태. 현재 구조상 callId 가 무한히 쌓이면 메모리 누수가
 * 발생할 수 있다. 정확한 재시도 판별을 위해 수신한 페이로드도 보존한다. 운영 단계에서 다음 중
 * 하나를 도입해야 하며, 인메모리 상태는 프로세스 재시작 또는 다중 인스턴스 간에 공유되지 않는다.
 * <ul>
 *   <li>{@code is_session_end=true} 수신 후 일정 시간 뒤 evict (지각 도착 재공격 방지)</li>
 *   <li>마지막 갱신 후 N시간 무활동 시 evict (스트림 끊김 대비)</li>
 *   <li>외부 캐시(Redis 등) 위임 — 다중 인스턴스 운영 시 필수</li>
 * </ul>
 */
@Component
public class TranscriptSessionRegistry {

    /**
     * callId 별 세션 상태. 키 무한 증가 가능성에 대한 운영 대응은 위 TODO 참조.
     */
    private final ConcurrentHashMap<String, SessionState> sessions = new ConcurrentHashMap<>();

    /**
     * 세그먼트 인입 검증 및 상태 갱신을 원자적으로 수행한다.
     *
     * <p>반환값 의미:
     * <ul>
     *   <li>{@link Result#OK} — 인입 허용. 레지스트리 상태가 갱신되었다.</li>
     *   <li>{@link Result#DUPLICATE} — 모든 필드가 이미 받은 페이로드와 같다. 재발행하지 않는다.</li>
     *   <li>{@link Result#SEQUENCE_CONFLICT} — 이미 받은 sequence에 다른 페이로드를 사용했다.</li>
     *   <li>{@link Result#SEQ_REGRESS} — 받은 적 없는 sequence가 lastSequence 이하이다.</li>
     *   <li>{@link Result#SESSION_ENDED} — 종료한 callId에 새로운 sequence를 사용했다.</li>
     * </ul>
     */
    public Result validateAndAccept(TranscriptSegment segment) {
        SessionState state = sessions.computeIfAbsent(segment.callId(), k -> new SessionState());
        synchronized (state) {
            TranscriptSegment accepted = state.accepted.get(segment.sequence());
            if (accepted != null) {
                return accepted.equals(segment) ? Result.DUPLICATE : Result.SEQUENCE_CONFLICT;
            }
            if (state.ended) {
                return Result.SESSION_ENDED;
            }
            if (state.lastSequence != null && segment.sequence() <= state.lastSequence) {
                return Result.SEQ_REGRESS;
            }
            state.lastSequence = segment.sequence();
            state.accepted.put(segment.sequence(), segment);
            if (segment.isSessionEnd()) {
                state.ended = true;
            }
            return Result.OK;
        }
    }

    /**
     * 검증 결과 enum. 컨트롤러는 이 값을 HTTP 상태로 매핑한다.
     */
    public enum Result {
        OK,
        DUPLICATE,
        SEQUENCE_CONFLICT,
        SEQ_REGRESS,
        SESSION_ENDED
    }

    /**
     * 세션별 상태. lastSequence 가 null 이면 첫 세그먼트 인입 전이다.
     * 본 클래스는 패키지 외부에서 직접 사용하지 않으므로 package-private 으로 둔다.
     */
    static final class SessionState {
        final Map<Integer, TranscriptSegment> accepted = new HashMap<>();
        Integer lastSequence;
        boolean ended;
    }
}
