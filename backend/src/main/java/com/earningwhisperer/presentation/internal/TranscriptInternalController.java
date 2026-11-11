package com.earningwhisperer.presentation.internal;

import com.earningwhisperer.domain.transcript.TranscriptSessionRegistry;
import com.earningwhisperer.domain.transcript.TranscriptSegment;
import com.earningwhisperer.domain.transcript.TranscriptService;
import com.earningwhisperer.infrastructure.analysis.CallAnalysisService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Data Pipeline → Backend 인입 엔드포인트.
 *
 * <p>Contract 6.4 — POST {@code /api/v1/internal/transcript-segment}
 * <ul>
 *   <li>인증: {@code X-Internal-Secret} (InternalSecretFilter 가 401 처리)</li>
 *   <li>202 (Accepted) — 신규 인입 또는 완전히 동일한 재시도. 재시도는 다시 발행하지 않는다.</li>
 *   <li>400: 필수 필드 누락 / 형식 오류 / sequence 단조 위반</li>
 *   <li>409: 같은 sequence의 다른 페이로드 또는 종료 후 새로운 sequence</li>
 *   <li>빈 text + is_session_end=true: 자막 내용 없는 종료 제어. 기존 비공백 최종 자막도 허용한다.</li>
 * </ul>
 *
 * <p>새로 받아들인 세그먼트는 시연 재생과 같은 분석 경로({@link CallAnalysisService})로 넘겨 팩트체크 · 직전 콜
 * 대조를 요청하고, 종료 신호에서 종합 판단을 낸다. {@code app.live-analysis.enabled=false} 면 자막과 번역만 나간다.
 *
 * <p>에러 응답은 {@code GlobalExceptionHandler} 의 {@code {"error": "..."}} 형식과 동일하게 맞춘다.
 */
@RestController
@RequestMapping("/api/v1/internal")
@RequiredArgsConstructor
public class TranscriptInternalController {

    private final TranscriptService transcriptService;
    private final CallAnalysisService callAnalysis;

    @PostMapping("/transcript-segment")
    public ResponseEntity<?> ingest(@Valid @RequestBody TranscriptSegmentRequest request) {
        TranscriptSegment segment = request.toDomain();
        TranscriptSessionRegistry.Result result = transcriptService.accept(segment);
        if (result == TranscriptSessionRegistry.Result.OK) {
            // 새로 받아들인 세그먼트만 분석에 넘긴다. 재전송(DUPLICATE)은 다시 분석하지 않는다.
            callAnalysis.onIngested(segment);
        }
        return switch (result) {
            case OK, DUPLICATE -> ResponseEntity.status(HttpStatus.ACCEPTED).build();
            case SEQUENCE_CONFLICT -> ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "conflicting payload for call_id=" + request.getCallId()
                            + " sequence=" + request.getSequence()));
            case SEQ_REGRESS -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "sequence regress detected for call_id=" + request.getCallId()));
            case SESSION_ENDED -> ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "session already ended for call_id=" + request.getCallId()));
        };
    }
}
