package com.earningwhisperer.presentation.internal;

import com.earningwhisperer.domain.transcript.TranscriptSegmentStore;
import com.earningwhisperer.domain.transcript.TranscriptService;
import com.earningwhisperer.domain.transcript.TranscriptSessionRegistry;
import com.earningwhisperer.global.exception.GlobalExceptionHandler;
import com.earningwhisperer.infrastructure.security.InternalSecretFilter;
import com.earningwhisperer.infrastructure.translation.TranscriptTranslationService;
import com.earningwhisperer.infrastructure.websocket.TranscriptPublisher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** In-process HTTP contract: real binding, validation, filter, controller, service, registry and
 * publisher; transport, Redis storage and translation are mocks. No external services. */
class BackendIngestRuntimeContractTest {
    private MockMvc mvc;
    private SimpMessagingTemplate websocket;
    private TranscriptSegmentStore store;
    private TranscriptTranslationService translation;
    private static final String URL = "/api/v1/internal/transcript-segment";

    @BeforeEach
    void setUp() {
        websocket = mock(SimpMessagingTemplate.class);
        store = mock(TranscriptSegmentStore.class);
        translation = mock(TranscriptTranslationService.class);
        var service = new TranscriptService(new TranscriptSessionRegistry(),
                new TranscriptPublisher(websocket), translation, store);
        var validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mvc = MockMvcBuilders.standaloneSetup(new TranscriptInternalController(service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .setValidator(validator)
                .addFilters(new InternalSecretFilter("isolated-test-only"))
                .build();
    }

    private String body(int sequence, boolean end, String text) {
        return """
                {"ticker":"EWTEST","call_id":"isolated-contract-only","sequence":%d,
                 "start_ms":0,"end_ms":20000,"text":"%s","speaker":null,
                 "timestamp":1794240000,"is_session_end":%s}
                """.formatted(sequence, text, end);
    }

    private void send(int sequence, boolean end, String text, int expected) throws Exception {
        mvc.perform(post(URL).header("X-Internal-Secret", "isolated-test-only")
                        .contentType(MediaType.APPLICATION_JSON).content(body(sequence, end, text)))
                .andExpect(status().is(expected));
    }

    @Test
    void normalPayloadIsPublishedStoredAndTranslated() throws Exception {
        send(0, false, "Revenue was one billion dollars.", 202);
        verify(websocket).convertAndSend(eq("/topic/transcript/EWTEST"), any(Object.class));
        verify(store).append(any());
        verify(translation).submit(any());
    }

    @Test
    void acceptedPayloadRetryIs202AndDoesNotRepeatSideEffects() throws Exception {
        send(0, false, "Same retry payload.", 202);
        send(0, false, "Same retry payload.", 202);
        verify(websocket, times(1)).convertAndSend(anyString(), any(Object.class));
        verify(store, times(1)).append(any());
        verify(translation, times(1)).submit(any());
    }

    @Test
    void laterSequenceCanArriveFirstAndMakesUnseenEarlierSequence400() throws Exception {
        send(1, false, "Later sentence.", 202);
        send(0, false, "Earlier sentence.", 400);
        verify(store, times(1)).append(any());
    }

    @Test
    void emptyEndControlClosesSessionAndAllExactRetriesAre202() throws Exception {
        send(0, false, "First sentence.", 202);
        send(1, true, "", 202);
        send(1, true, "", 202);
        send(0, false, "First sentence.", 202);
        send(2, false, "Later sentence.", 409);
        verify(websocket, times(2)).convertAndSend(anyString(), any(Object.class));
        verify(store, times(1)).append(any());
        verify(translation, times(2)).submit(any());
    }

    @Test
    void nonemptyFinalSegmentRemainsCompatibleAndItsRetryIs202() throws Exception {
        send(0, false, "First sentence.", 202);
        send(1, true, "Thank you.", 202);
        send(1, true, "Thank you.", 202);
        send(2, false, "Later sentence.", 409);
        verify(store, times(2)).append(any());
    }

    @Test
    void conflictingDuplicateCannotOverwriteTextOrCloseSession() throws Exception {
        send(0, false, "Original sentence.", 202);
        send(0, false, "Changed sentence.", 409);
        send(0, true, "Original sentence.", 409);
        send(1, false, "Next sentence.", 202);
        verify(store, times(2)).append(any());
    }

    @Test
    void retryWithRegeneratedTimestampIsConflict() throws Exception {
        send(0, false, "Same text, new clock.", 202);
        mvc.perform(post(URL).header("X-Internal-Secret", "isolated-test-only")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(0, false, "Same text, new clock.")
                                .replace("1794240000", "1794240001")))
                .andExpect(status().isConflict());
        verify(websocket, times(1)).convertAndSend(anyString(), any(Object.class));
        verify(store, times(1)).append(any());
    }

    @Test
    void emptyOrdinaryTextAndWhitespaceTerminalRemainInvalid() throws Exception {
        send(0, false, "", 400);
        send(0, true, "   ", 400);
        mvc.perform(post(URL).header("X-Internal-Secret", "isolated-test-only")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(0, true, "").replace("\"text\":\"\"", "\"text\":null")))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(websocket, store, translation);
    }

    @Test
    void allDownstreamFailuresStillReturn202AndExactRetryDoesNotRepeatEffects() throws Exception {
        doThrow(new IllegalStateException("isolated websocket failure")).when(websocket)
                .convertAndSend(anyString(), any(Object.class));
        doThrow(new IllegalStateException("isolated store failure")).when(store).append(any());
        doThrow(new IllegalStateException("isolated translation failure")).when(translation).submit(any());
        send(0, false, "Acknowledgement is not durable delivery.", 202);
        send(0, false, "Acknowledgement is not durable delivery.", 202);
        verify(websocket, times(1)).convertAndSend(anyString(), any(Object.class));
        verify(store, times(1)).append(any());
        verify(translation, times(1)).submit(any());
    }
}
