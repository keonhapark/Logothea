package com.earningwhisperer.infrastructure.analysis;

import com.earningwhisperer.domain.transcript.TranscriptSegment;
import com.earningwhisperer.infrastructure.aiengine.AiEngineClient;
import com.earningwhisperer.infrastructure.aiengine.LiveFactCheckModels;
import com.earningwhisperer.infrastructure.aiengine.TranscriptDiffModels;
import com.earningwhisperer.infrastructure.demo.EarningsSummaryService;
import com.earningwhisperer.infrastructure.websocket.FactCheckPublisher;
import com.earningwhisperer.infrastructure.websocket.TranscriptDiffPublisher;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 어닝콜 한 회차의 AI 분석(팩트체크 · 직전 콜 대조 · 종합 판단) 요청을 맡는다.
 *
 * <p>자막이 어디서 왔는지와 상관없이 같은 경로를 탄다. 시연 재생은 {@link #open} 으로 회차를 열어 세그먼트를
 * 넘기고, data_pipeline 실시간 인입은 {@link #onIngested} 가 callId 마다 회차를 자동으로 연다. 분석 로직은 모두
 * AI Engine 에 있고, 여기서는 순서 · 스레드 · 회차 수명만 다룬다.
 *
 * <ul>
 *   <li>팩트체크와 대조는 회차마다 단일 스레드 큐를 따로 둔다. 엔진이 ticker 버퍼를 순서대로 쌓기 때문이다.</li>
 *   <li>종합 판단은 회차가 끝났을 때 한 번, 전용 단일 스레드에서 돈다. 그 사이 같은 종목의 새 회차가 열렸으면
 *       지난 회차의 판단은 버린다(진행 중인 콜 위에 지난 결론이 뜨지 않게).</li>
 *   <li>실시간 회차는 종료 신호를 받지 못하면 {@code app.live-analysis.idle-timeout-minutes} 뒤에 정리한다.</li>
 *   <li>시연이 재생 중인 종목의 실시간 자막은 분석하지 않는다. AI Engine 이 팩트체크 버퍼를 콜이 아니라 종목 단위로
 *       잡아서, 두 흐름의 sequence 가 섞이면 양쪽 팩트체크가 조용히 거부된다.</li>
 * </ul>
 *
 * <p>실시간 분석은 기본으로 꺼져 있다({@code app.live-analysis.enabled}). 1시간 콜이면 세그먼트 수백 건만큼
 * AI Engine 호출이 생겨, 무료 등급 한도를 시연 전에 써 버릴 수 있기 때문이다.
 */
@Slf4j
@Service
public class CallAnalysisService {

    /** 이 이상 큐가 쌓이면 분석이 자막을 따라가지 못하고 있다는 뜻이다. */
    static final int QUEUE_WARN_THRESHOLD = 3;

    static final String LIVE_THREAD_PREFIX = "live-call";

    private final AiEngineClient aiEngineClient;
    private final FactCheckPublisher factCheckPublisher;
    private final TranscriptDiffPublisher transcriptDiffPublisher;
    private final EarningsSummaryService summaryService;
    private final long aiEngineTimeoutMs;
    private final boolean liveEnabled;
    private final Duration liveIdleTimeout;

    /**
     * 종합 판단 전용 스레드. 회차 스레드에서 부르지 않는 이유: 회차를 닫을 때 큐 스레드를 shutdownNow 로
     * 인터럽트하므로, 그 위에서 수 초짜리 HTTP 호출을 이어 붙이면 인터럽트 플래그를 안고 돈다.
     */
    private final ExecutorService summaryExecutor = singleThread("call-summary");

    /** 실시간 회차를 닫을 때 큐가 빌 때까지 기다리는 일을 HTTP 스레드 밖에서 한다. */
    private final ExecutorService closer = singleThread("call-analysis-closer");

    /** ticker → 가장 최근에 열린 회차의 callId. 지난 회차의 종합 판단을 거르는 데 쓴다. */
    private final Map<String, String> latestCallIds = new ConcurrentHashMap<>();

    /** callId → 실시간 인입 회차. 시연 회차는 시연 서비스가 직접 들고 있다. */
    private final Map<String, CallHandle> liveCalls = new ConcurrentHashMap<>();

    /** 대문자 ticker → 열려 있는 시연 회차. 이 종목의 실시간 자막은 분석하지 않는다. */
    private final Map<String, CallHandle> demoCalls = new ConcurrentHashMap<>();

    public CallAnalysisService(
            AiEngineClient aiEngineClient,
            FactCheckPublisher factCheckPublisher,
            TranscriptDiffPublisher transcriptDiffPublisher,
            EarningsSummaryService summaryService,
            @Value("${ai-engine.timeout-ms:8000}") long aiEngineTimeoutMs,
            @Value("${app.live-analysis.enabled:false}") boolean liveEnabled,
            @Value("${app.live-analysis.idle-timeout-minutes:30}") long idleTimeoutMinutes) {
        this.aiEngineClient = aiEngineClient;
        this.factCheckPublisher = factCheckPublisher;
        this.transcriptDiffPublisher = transcriptDiffPublisher;
        this.summaryService = summaryService;
        this.aiEngineTimeoutMs = Math.max(0, aiEngineTimeoutMs);
        this.liveEnabled = liveEnabled;
        this.liveIdleTimeout = Duration.ofMinutes(Math.max(1, idleTimeoutMinutes));
    }

    /**
     * 회차 부가 정보. 시연은 스크립트에서, 실시간은 없음.
     *
     * @param replayKey        같은 스크립트를 가리키는 키. 있으면 팩트체크를 회차 단위로 녹화 · 재생한다(응답 기억이 켜졌을 때)
     * @param expectedSegments 한 회차의 세그먼트 수. 녹화가 다 찼는지 판단한다
     * @param summaryAsOfEpoch 종합 판단의 기준 시각(Unix 초). 과거 콜 재생은 원래 콜이 끝난 시각, 실시간은 null(엔진이 현재 시각을 씀)
     */
    public record CallContext(List<String> relatedTickers, String analystQuestion, String analystAnswer,
                              String replayKey, int expectedSegments, Long summaryAsOfEpoch) {
        public static final CallContext NONE = new CallContext(List.of(), null, null, null, 0, null);

        public CallContext(List<String> relatedTickers, String analystQuestion, String analystAnswer) {
            this(relatedTickers, analystQuestion, analystAnswer, null, 0, null);
        }
    }

    /**
     * 같은 스크립트 회차의 팩트체크 응답 녹화. 엔진은 종목 버퍼(상태)를 가져서, 일부 문장만 기억으로 대신하면 버퍼가
     * 어긋나 이후 배치가 거부된다. 그래서 한 회차 전체가 쓸 만한 응답으로 채워졌을 때만 다음 회차를 통째로 재생하고,
     * 하나라도 빠지거나 나쁘면 다음 회차는 다시 엔진으로 보내 새로 녹화한다.
     */
    static final class FactCheckRecording {
        private final int expected;
        private final Map<Integer, LiveFactCheckModels.BatchResponse> responses = new ConcurrentHashMap<>();
        private volatile boolean failed;

        FactCheckRecording(int expected) {
            this.expected = expected;
        }

        void record(int sequence, boolean sessionEnd, java.util.Optional<LiveFactCheckModels.BatchResponse> response) {
            if (response.isPresent() && replayable(response.get(), sessionEnd)) {
                responses.put(sequence, response.get());
            } else {
                failed = true;
            }
        }

        boolean isComplete() {
            return !failed && responses.size() == expected;
        }

        java.util.Optional<LiveFactCheckModels.BatchResponse> get(int sequence) {
            return java.util.Optional.ofNullable(responses.get(sequence));
        }

        /** 검색 · LLM 단계가 실패해 나온 판정. 회차마다 달라질 수 있어 다시 보여 주지 않는다. */
        static final java.util.Set<String> TRANSIENT_FAILURE_REASONS =
                java.util.Set.of("retrieval_failed", "llm_failed", "invalid_llm_response");

        /**
         * 다시 보여 줘도 되는 응답인지. 대기(BUFFERING)와, 주장마다 검색 · LLM 실패가 없는 완료는 쓴다. 근거가 없어
         * 나온 "근거 부족" 판정은 회차마다 같으므로 쓴다. 거부(REJECTED)는 쓰지 않고, 마지막 문장의 DISCARDED 는 정상 종료다.
         *
         * <p>{@code verification_llm_used} 는 "근거가 하나라도 채택됐는지" 라 LLM 성공 여부를 가리지 못해 쓰지 않는다.
         */
        static boolean replayable(LiveFactCheckModels.BatchResponse response, boolean sessionEnd) {
            if ("BUFFERING".equals(response.status())) {
                return true;
            }
            if (response.isCompleted()) {
                return !response.hasClaims() || response.claims().stream()
                        .noneMatch(claim -> claim != null && TRANSIENT_FAILURE_REASONS.contains(claim.reasonCode()));
            }
            return sessionEnd && "DISCARDED".equals(response.status());
        }
    }

    /** replayKey → 그 스크립트의 가장 최근 팩트체크 녹화. */
    private final Map<String, FactCheckRecording> factCheckRecordings = new ConcurrentHashMap<>();

    /** 정상 종료 때 분석 큐를 비우며 기다려 줄 시간. AI Engine 타임아웃보다 넉넉히 둔다. */
    public long drainGraceMillis() {
        return aiEngineTimeoutMs + 2_000;
    }

    /**
     * 회차를 연다. 같은 종목의 최신 회차로 기록한다.
     *
     * @param threadPrefix 스레드 이름 앞부분. 시연은 {@code demo-call}
     */
    public CallHandle open(String ticker, String callId, CallContext context, String threadPrefix) {
        CallHandle handle = openHandle(ticker, callId, context, threadPrefix);
        demoCalls.put(key(ticker), handle);
        return handle;
    }

    private CallHandle openHandle(String ticker, String callId, CallContext context, String threadPrefix) {
        latestCallIds.put(key(ticker), callId);
        return new CallHandle(ticker, callId, context == null ? CallContext.NONE : context, threadPrefix);
    }

    private static String key(String ticker) {
        return ticker == null ? "" : ticker.trim().toUpperCase();
    }

    /**
     * data_pipeline 실시간 인입에서 새로 받아들인 세그먼트(재전송 아님)를 분석에 넘긴다.
     * 종료 신호면 종합 판단을 내고 회차를 닫는다. HTTP 스레드에서 불리므로 기다리지 않는다.
     */
    public void onIngested(TranscriptSegment segment) {
        if (!liveEnabled) {
            return;
        }
        if (demoCalls.containsKey(key(segment.ticker()))) {
            log.debug("[CallAnalysis] 시연 재생 중인 종목이라 실시간 자막을 분석하지 않습니다 - ticker={} call_id={}",
                    segment.ticker(), segment.callId());
            return;
        }
        CallHandle handle = liveCalls.computeIfAbsent(segment.callId(),
                callId -> openHandle(segment.ticker(), callId, CallContext.NONE, LIVE_THREAD_PREFIX));
        handle.submit(segment);
        if (segment.isSessionEnd()) {
            liveCalls.remove(segment.callId(), handle);
            handle.submitSummary();
            closeLater(handle, drainGraceMillis());
        }
    }

    /** 종료 신호 없이 오래 조용한 실시간 회차를 정리한다. 종합 판단은 내지 않는다. */
    @Scheduled(fixedDelayString = "${app.live-analysis.reap-interval-ms:300000}")
    void reapIdleLiveCalls() {
        long cutoff = System.currentTimeMillis() - liveIdleTimeout.toMillis();
        liveCalls.forEach((callId, handle) -> {
            if (handle.lastActivityMillis < cutoff && liveCalls.remove(callId, handle)) {
                log.warn("[CallAnalysis] 종료 신호 없이 {}분 동안 자막이 없어 회차를 정리합니다 - ticker={} call_id={}",
                        liveIdleTimeout.toMinutes(), handle.ticker, callId);
                closeLater(handle, 0);
            }
        });
    }

    /** 테스트용. */
    int liveCallCount() {
        return liveCalls.size();
    }

    /** 테스트용. */
    boolean isDemoActive(String ticker) {
        return demoCalls.containsKey(key(ticker));
    }

    private void closeLater(CallHandle handle, long graceMillis) {
        try {
            closer.execute(() -> handle.close(graceMillis));
        } catch (RejectedExecutionException e) {
            handle.cancel();
        }
    }

    @PreDestroy
    public void shutdown() {
        liveCalls.values().forEach(CallHandle::cancel);
        liveCalls.clear();
        demoCalls.values().forEach(CallHandle::cancel);
        demoCalls.clear();
        latestCallIds.clear();
        closer.shutdownNow();
        summaryExecutor.shutdown();
        try {
            if (!summaryExecutor.awaitTermination(1_500, TimeUnit.MILLISECONDS)) {
                List<Runnable> dropped = summaryExecutor.shutdownNow();
                // "마지막 회차 종합 판단이 안 왔다" 의 원인이 로그에 남도록 몇 건인지 적는다.
                log.warn("[CallAnalysis] 종료 중 종합 판단 {}건을 버렸습니다(진행 중 1건 포함 가능)", dropped.size());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            summaryExecutor.shutdownNow();
        }
    }

    /** 어닝콜 한 회차의 분석 큐. */
    public final class CallHandle {
        private final String ticker;
        private final String callId;
        private final CallContext context;
        private final AtomicBoolean cancelled = new AtomicBoolean(false);
        /** 큐 깊이를 관찰해야 하므로 ThreadPoolExecutor 로 직접 만든다. */
        private final ThreadPoolExecutor factCheck;
        /** 대조 전용. 팩트체크와 지연을 나눠 갖기 위해 따로 둔다. */
        private final ThreadPoolExecutor transcriptDiff;
        /** 종합 판단에 넘길 전문. 받아들인 순서대로 쌓는다. */
        private final List<String> texts = new ArrayList<>();
        private volatile long lastActivityMillis = System.currentTimeMillis();
        /** 이 회차가 엔진 대신 재생할 녹화. null 이면 엔진을 부른다. */
        private final FactCheckRecording replayFrom;
        /** 이 회차가 엔진 응답을 남길 녹화. 재생 회차이거나 녹화 대상이 아니면 null. */
        private final FactCheckRecording recordInto;

        private CallHandle(String ticker, String callId, CallContext context, String threadPrefix) {
            this.ticker = ticker;
            this.callId = callId;
            this.context = context;
            this.factCheck = singleThread(threadPrefix + "-fc-" + ticker);
            this.transcriptDiff = singleThread(threadPrefix + "-diff-" + ticker);
            String replayKey = context.replayKey();
            if (aiEngineClient.isResponseMemoEnabled() && replayKey != null && context.expectedSegments() > 0) {
                FactCheckRecording existing = factCheckRecordings.get(replayKey);
                if (existing != null && existing.isComplete()) {
                    this.replayFrom = existing;
                    this.recordInto = null;
                    log.info("[CallAnalysis] 팩트체크를 지난 회차 녹화로 재생합니다 - ticker={} call_id={}", ticker, callId);
                } else {
                    this.replayFrom = null;
                    this.recordInto = new FactCheckRecording(context.expectedSegments());
                    factCheckRecordings.put(replayKey, recordInto);
                }
            } else {
                this.replayFrom = null;
                this.recordInto = null;
            }
        }

        public String callId() {
            return callId;
        }

        /**
         * 받아들인 세그먼트를 팩트체크 · 대조 큐에 넘긴다. 호출 스레드는 기다리지 않는다.
         * 본문 없는 종료 신호는 분석할 문장이 없으므로 전문에도 큐에도 넣지 않는다.
         */
        public void submit(TranscriptSegment segment) {
            lastActivityMillis = System.currentTimeMillis();
            if (cancelled.get() || segment.text() == null || segment.text().isBlank()) {
                return;
            }
            synchronized (texts) {
                texts.add(segment.text());
            }
            submitForFactCheck(segment);
            submitForTranscriptDiff(segment);
        }

        /**
         * 종합 판단을 전용 스레드에 넘긴다. 받아들인 전문이 없으면 내지 않는다.
         * 큐에서 기다리는 사이 같은 종목의 새 회차가 열렸으면 버린다.
         */
        public void submitSummary() {
            if (cancelled.get()) {
                return;
            }
            String transcript;
            synchronized (texts) {
                transcript = String.join(" ", texts).trim();
            }
            if (transcript.isEmpty()) {
                return;
            }
            try {
                // submit 이 아니라 execute 다. submit 은 Throwable 을 아무도 보지 않는 Future 에 가둬 버린다.
                summaryExecutor.execute(() -> {
                    String latest = latestCallIds.get(key(ticker));
                    if (latest != null && !latest.equals(callId)) {
                        log.warn("[CallAnalysis] 지난 회차의 종합 판단을 버립니다 - ticker={} call_id={} 최신={}",
                                ticker, callId, latest);
                        return;
                    }
                    try {
                        summaryService.summarizeAndPublish(ticker, callId, transcript, context.relatedTickers(),
                                context.analystQuestion(), context.analystAnswer(), context.summaryAsOfEpoch());
                    } catch (Throwable e) {
                        // Exception 만 잡으면 Error 계열이 스레드를 조용히 죽이고 다음 회차부터 판단이 사라진다.
                        log.error("[CallAnalysis] 종합 판단 실패 - ticker={} call_id={} error={}",
                                ticker, callId, e.toString(), e);
                    }
                });
            } catch (RejectedExecutionException e) {
                log.warn("[CallAnalysis] 종합 판단을 제출하지 못했습니다(종료 중) - ticker={} call_id={}", ticker, callId);
            }
        }

        /** 남은 분석을 버리고 즉시 닫는다(중지 경로). 큐에 남은 작업은 실행되지 않는다. */
        public void cancel() {
            demoCalls.remove(key(ticker), this);
            cancelled.set(true);
            factCheck.shutdownNow();
            transcriptDiff.shutdownNow();
        }

        /**
         * 큐를 닫는다. {@code graceMillis} 동안 남은 분석이 끝나기를 기다린 뒤 강제로 닫는다. 0 이면 바로 닫는다.
         * 대기는 두 큐가 나눠 쓴다. 각각에 전체 시간을 주면 최악의 경우 두 배를 기다린다.
         */
        public void close(long graceMillis) {
            demoCalls.remove(key(ticker), this);
            factCheck.shutdown();
            transcriptDiff.shutdown();
            if (graceMillis > 0) {
                long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(graceMillis);
                awaitQuietly(factCheck, "팩트체크", remainingMillis(deadline));
                awaitQuietly(transcriptDiff, "과거 콜 대조", remainingMillis(deadline));
            }
            factCheck.shutdownNow();
            transcriptDiff.shutdownNow();
        }

        private void submitForFactCheck(TranscriptSegment segment) {
            if (!aiEngineClient.isFactCheckEnabled()) {
                return;
            }
            LiveFactCheckModels.SentenceRequest request = new LiveFactCheckModels.SentenceRequest(
                    ticker, segment.text(), segment.sequence(), segment.timestamp(), segment.isSessionEnd());
            int queued = factCheck.getQueue().size();
            if (queued >= QUEUE_WARN_THRESHOLD) {
                log.warn("[CallAnalysis] 팩트체크 큐 적체 - ticker={} queued={} (AI Engine 응답이 자막보다 느립니다. "
                        + "카드가 자막보다 점점 뒤처집니다)", ticker, queued);
            }
            try {
                factCheck.execute(() -> {
                    if (cancelled.get()) {
                        return;
                    }
                    if (replayFrom != null) {
                        replayFrom.get(segment.sequence())
                                .ifPresent(batch -> factCheckPublisher.publish(ticker, callId, batch));
                        return;
                    }
                    java.util.Optional<LiveFactCheckModels.BatchResponse> response = aiEngineClient.submitSentence(request);
                    if (recordInto != null) {
                        recordInto.record(segment.sequence(), segment.isSessionEnd(), response);
                    }
                    response.ifPresent(batch -> factCheckPublisher.publish(ticker, callId, batch));
                });
            } catch (RejectedExecutionException e) {
                log.debug("[CallAnalysis] 팩트체크 제출 생략(종료 중) - ticker={} sequence={}", ticker, segment.sequence());
            } catch (Exception e) {
                log.warn("[CallAnalysis] 팩트체크 제출 실패 - ticker={} sequence={} error={}",
                        ticker, segment.sequence(), e.toString());
            }
        }

        /**
         * 모든 세그먼트를 대조에 넘긴다. 주제와 무관한 발언은 엔진이 {@code current_chunk_not_material} 로 걸러 내고,
         * 발행자가 빈 결과를 버린다. 백엔드에서 미리 주제를 판정하면 엔진의 판정 기준과 둘로 갈린다.
         */
        private void submitForTranscriptDiff(TranscriptSegment segment) {
            if (!aiEngineClient.isTranscriptDiffEnabled()) {
                return;
            }
            TranscriptDiffModels.DiffRequest request =
                    TranscriptDiffModels.DiffRequest.forEarningsCall(ticker, segment.text(), segment.timestamp());
            int queued = transcriptDiff.getQueue().size();
            if (queued >= QUEUE_WARN_THRESHOLD) {
                log.warn("[CallAnalysis] 과거 콜 대조 큐 적체 - ticker={} queued={} (ai-engine.transcript-diff-enabled=false "
                        + "로 끄면 팩트체크만 남습니다)", ticker, queued);
            }
            try {
                transcriptDiff.execute(() -> {
                    if (cancelled.get()) {
                        return;
                    }
                    aiEngineClient.transcriptDiff(request)
                            .ifPresent(diff -> transcriptDiffPublisher.publish(ticker, callId, segment.sequence(), diff));
                });
            } catch (RejectedExecutionException e) {
                log.debug("[CallAnalysis] 과거 콜 대조 제출 생략(종료 중) - ticker={} sequence={}",
                        ticker, segment.sequence());
            } catch (Exception e) {
                log.warn("[CallAnalysis] 과거 콜 대조 제출 실패 - ticker={} sequence={} error={}",
                        ticker, segment.sequence(), e.toString());
            }
        }

        private void awaitQuietly(ThreadPoolExecutor executor, String label, long millis) {
            if (millis <= 0) {
                return;
            }
            try {
                if (!executor.awaitTermination(millis, TimeUnit.MILLISECONDS)) {
                    log.warn("[CallAnalysis] {} 큐를 {}ms 내에 비우지 못했습니다 - ticker={} 남은 작업={}",
                            label, millis, ticker, executor.getQueue().size());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static long remainingMillis(long deadlineNanos) {
        return Math.max(0, TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime()));
    }

    private static ThreadPoolExecutor singleThread(String name) {
        return new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(), r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        });
    }
}
