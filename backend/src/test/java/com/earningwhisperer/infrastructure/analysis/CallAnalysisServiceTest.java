package com.earningwhisperer.infrastructure.analysis;

import com.earningwhisperer.domain.transcript.TranscriptSegment;
import com.earningwhisperer.infrastructure.aiengine.AiEngineClient;
import com.earningwhisperer.infrastructure.aiengine.LiveFactCheckModels;
import com.earningwhisperer.infrastructure.aiengine.TranscriptDiffModels;
import com.earningwhisperer.infrastructure.demo.EarningsSummaryService;
import com.earningwhisperer.infrastructure.websocket.FactCheckPublisher;
import com.earningwhisperer.infrastructure.websocket.TranscriptDiffPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@DisplayName("CallAnalysisService 실시간 인입")
class CallAnalysisServiceTest {

    private AiEngineClient client;
    private FactCheckPublisher factCheckPublisher;
    private TranscriptDiffPublisher diffPublisher;
    private EarningsSummaryService summaryService;
    private CallAnalysisService service;

    @BeforeEach
    void setUp() {
        client = mock(AiEngineClient.class);
        factCheckPublisher = mock(FactCheckPublisher.class);
        diffPublisher = mock(TranscriptDiffPublisher.class);
        summaryService = mock(EarningsSummaryService.class);
        when(client.isFactCheckEnabled()).thenReturn(true);
        when(client.isTranscriptDiffEnabled()).thenReturn(true);
        when(client.submitSentence(any())).thenReturn(Optional.empty());
        when(client.transcriptDiff(any())).thenReturn(Optional.empty());
        service = newService(true);
    }

    @AfterEach
    void tearDown() {
        service.shutdown();
    }

    private CallAnalysisService newService(boolean liveEnabled) {
        return new CallAnalysisService(client, factCheckPublisher, diffPublisher, summaryService, 200, liveEnabled, 30);
    }

    private static TranscriptSegment segment(String callId, int sequence, String text, boolean end) {
        return new TranscriptSegment("CSCO", callId, sequence, sequence * 10_000L, sequence * 10_000L + 10_000L,
                text, null, 1_794_000_000L + sequence, end);
    }

    @Test
    @DisplayName("세그먼트마다 팩트체크와 대조를 순서대로 요청한다")
    void submitsFactCheckAndDiff() {
        service.onIngested(segment("c1", 0, "Revenue grew 8%.", false));
        service.onIngested(segment("c1", 1, "Margins expanded.", false));

        ArgumentCaptor<LiveFactCheckModels.SentenceRequest> fc =
                ArgumentCaptor.forClass(LiveFactCheckModels.SentenceRequest.class);
        verify(client, timeout(2_000).times(2)).submitSentence(fc.capture());
        assertThat(fc.getAllValues()).extracting(LiveFactCheckModels.SentenceRequest::sentenceSequence)
                .containsExactly(0, 1);
        verify(client, timeout(2_000).times(2)).transcriptDiff(any(TranscriptDiffModels.DiffRequest.class));
        assertThat(service.liveCallCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("팩트체크 결과가 오면 그 회차 callId 로 발행한다")
    void publishesFactCheckResult() {
        LiveFactCheckModels.BatchResponse batch = mock(LiveFactCheckModels.BatchResponse.class);
        when(client.submitSentence(any())).thenReturn(Optional.of(batch));

        service.onIngested(segment("c1", 0, "Revenue grew 8%.", false));

        verify(factCheckPublisher, timeout(2_000)).publish("CSCO", "c1", batch);
    }

    @Test
    @DisplayName("본문 없는 종료 신호는 분석하지 않고, 받은 전문으로 종합 판단을 한 번 낸 뒤 회차를 닫는다")
    void emptyEndControlSummarizesAndCloses() {
        service.onIngested(segment("c1", 0, "Revenue grew 8%.", false));
        service.onIngested(segment("c1", 1, "Guidance raised.", false));
        service.onIngested(segment("c1", 2, "", true));

        verify(summaryService, timeout(2_000)).summarizeAndPublish(
                "CSCO", "c1", "Revenue grew 8%. Guidance raised.", List.of(), null, null);
        verify(client, after(300).times(2)).submitSentence(any());
        assertThat(service.liveCallCount()).isZero();
    }

    @Test
    @DisplayName("본문 있는 마지막 자막은 분석하고 종료 표시를 팩트체크에도 싣는다")
    void finalSegmentWithText() {
        service.onIngested(segment("c1", 0, "Thank you.", true));

        ArgumentCaptor<LiveFactCheckModels.SentenceRequest> fc =
                ArgumentCaptor.forClass(LiveFactCheckModels.SentenceRequest.class);
        verify(client, timeout(2_000)).submitSentence(fc.capture());
        assertThat(fc.getValue().isSessionEnd()).isTrue();
        verify(summaryService, timeout(2_000)).summarizeAndPublish(
                eq("CSCO"), eq("c1"), eq("Thank you."), any(), any(), any());
    }

    @Test
    @DisplayName("종합 판단이 큐에서 기다리는 사이 같은 종목의 새 회차가 열리면 지난 판단은 버린다")
    void dropsStaleSummary() {
        service.onIngested(segment("old", 0, "Old call.", false));
        service.onIngested(segment("new", 0, "New call.", false));
        service.onIngested(segment("old", 1, "", true));

        verify(summaryService, after(500).never())
                .summarizeAndPublish(anyString(), eq("old"), anyString(), any(), any(), any());
    }

    @Test
    @DisplayName("시연이 재생 중인 종목의 실시간 자막은 분석하지 않고, 시연이 끝나면 다시 분석한다")
    void skipsTickerWhileDemoRuns() {
        CallAnalysisService.CallHandle demo =
                service.open("csco", "demo-1", CallAnalysisService.CallContext.NONE, "demo-call");

        service.onIngested(segment("live-1", 0, "Revenue grew 8%.", false));
        verify(client, after(300).never()).submitSentence(any());
        assertThat(service.liveCallCount()).isZero();

        demo.cancel();
        assertThat(service.isDemoActive("CSCO")).isFalse();
        service.onIngested(segment("live-1", 1, "Margins expanded.", false));
        verify(client, timeout(2_000)).submitSentence(any());
    }

    @Test
    @DisplayName("시연 회차를 정상 종료해도 시연 표시가 풀린다")
    void demoCloseReleasesTicker() {
        CallAnalysisService.CallHandle demo =
                service.open("CSCO", "demo-1", CallAnalysisService.CallContext.NONE, "demo-call");
        assertThat(service.isDemoActive("CSCO")).isTrue();

        demo.close(0);

        assertThat(service.isDemoActive("CSCO")).isFalse();
    }

    @Test
    @DisplayName("자막이 없었던 회차는 종료 신호가 와도 종합 판단을 내지 않는다")
    void noTranscriptNoSummary() {
        service.onIngested(segment("c1", 0, "", true));

        verify(summaryService, after(300).never())
                .summarizeAndPublish(anyString(), anyString(), anyString(), any(), any(), any());
    }

    @Test
    @DisplayName("꺼져 있으면 AI Engine 을 부르지 않는다")
    void disabled() {
        service.shutdown();
        service = newService(false);

        service.onIngested(segment("c1", 0, "Revenue grew 8%.", false));
        service.onIngested(segment("c1", 1, "", true));

        verify(client, after(300).never()).submitSentence(any());
        verifyNoInteractions(summaryService);
        assertThat(service.liveCallCount()).isZero();
    }

    @Test
    @DisplayName("종료 신호 없이 조용해진 회차는 정리하고 종합 판단은 내지 않는다")
    void reapsIdleCalls() throws Exception {
        CallAnalysisService shortIdle = new CallAnalysisService(
                client, factCheckPublisher, diffPublisher, summaryService, 200, true, 1);
        try {
            shortIdle.onIngested(segment("c1", 0, "Revenue grew 8%.", false));
            assertThat(shortIdle.liveCallCount()).isEqualTo(1);

            // 마지막 활동 시각을 1분보다 앞으로 돌린다.
            java.lang.reflect.Field handles = CallAnalysisService.class.getDeclaredField("liveCalls");
            handles.setAccessible(true);
            @SuppressWarnings("unchecked")
            java.util.Map<String, CallAnalysisService.CallHandle> map =
                    (java.util.Map<String, CallAnalysisService.CallHandle>) handles.get(shortIdle);
            java.lang.reflect.Field last = CallAnalysisService.CallHandle.class.getDeclaredField("lastActivityMillis");
            last.setAccessible(true);
            last.setLong(map.get("c1"), System.currentTimeMillis() - 61_000);

            shortIdle.reapIdleLiveCalls();

            assertThat(shortIdle.liveCallCount()).isZero();
            verify(summaryService, after(300).never())
                    .summarizeAndPublish(anyString(), anyString(), anyString(), any(), any(), any());
        } finally {
            shortIdle.shutdown();
        }
    }

    @Test
    @DisplayName("팩트체크가 꺼져 있으면 대조만 요청한다")
    void factCheckDisabled() {
        when(client.isFactCheckEnabled()).thenReturn(false);

        service.onIngested(segment("c1", 0, "Revenue grew 8%.", false));

        verify(client, timeout(2_000)).transcriptDiff(any());
        verify(client, never()).submitSentence(any());
        verify(client, times(1)).isFactCheckEnabled();
    }
}
