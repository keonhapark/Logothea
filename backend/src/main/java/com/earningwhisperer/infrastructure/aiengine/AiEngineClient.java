package com.earningwhisperer.infrastructure.aiengine;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;
import java.util.function.Predicate;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Collections;

/**
 * AI Engine 호출 클라이언트 (Contract 9).
 *
 * <p>정책: <b>시연 중 화면이 멈추는 것보다 팩트체크가 빠지는 편이 낫다.</b>
 * 따라서 모든 실패(타임아웃 / 4xx / 5xx / 역직렬화 오류)를 흡수해
 * {@link Optional#empty()} 로 돌려주고 예외를 재던지지 않는다. 호출자는 결과가 없으면
 * 그냥 발행을 건너뛴다.
 *
 * <p>{@code fact-check-enabled=false} / {@code summary-enabled=false} 로 두면 각각
 * 호출 자체를 하지 않는다. AI Engine 을 띄우지 않고 트랜스크립트 재생만 시연할 때 쓴다.
 */
@Slf4j
@Component
public class AiEngineClient {

    private static final String SENTENCE_PATH = "/v1/engine/live-fact-check/sentence";
    private static final String ANALYZE_PATH = "/v1/engine/analyze";
    private static final String INTELLIGENCE_PATH = "/v1/engine/earnings/intelligence";
    private static final String READINESS_PATH = "/v1/engine/evidence/readiness";
    private static final String TRANSCRIPT_DIFF_PATH = "/v1/engine/transcript/diff";
    private static final String TRANSCRIPT_TRANSLATE_PATH = "/v1/engine/transcript/translate";

    private final RestClient restClient;
    /**
     * 번역 전용. 번역은 단일 스레드에서 차례로 부르므로, 공용 읽기 타임아웃(기본 50초)을 쓰면 엔진이 멈췄을 때
     * 뒤의 번역이 모두 그만큼 밀린다. 엔진 내부 제한(6초)보다 조금 길게 둔다.
     */
    private final RestClient translationRestClient;
    private final boolean factCheckEnabled;
    private final boolean summaryEnabled;
    private final boolean transcriptDiffEnabled;
    private final boolean translationEnabled;

    /**
     * 생성자가 여럿이므로 Spring 이 쓸 것을 명시한다. 없으면 기본 생성자를 찾다가
     * BeanInstantiationException 으로 기동이 실패한다.
     */
    @Autowired
    public AiEngineClient(
            @Value("${ai-engine.base-url:http://localhost:8000}") String baseUrl,
            @Value("${ai-engine.fact-check-enabled:true}") boolean factCheckEnabled,
            @Value("${ai-engine.summary-enabled:true}") boolean summaryEnabled,
            @Value("${ai-engine.transcript-diff-enabled:true}") boolean transcriptDiffEnabled,
            @Value("${ai-engine.translation-enabled:true}") boolean translationEnabled,
            @Value("${ai-engine.timeout-ms:8000}") long timeoutMs,
            @Value("${ai-engine.translation-timeout-ms:15000}") long translationTimeoutMs
    ) {
        this.factCheckEnabled = factCheckEnabled;
        this.summaryEnabled = summaryEnabled;
        this.transcriptDiffEnabled = transcriptDiffEnabled;
        this.translationEnabled = translationEnabled;
        // 연결 타임아웃은 짧게(응답 없는 호스트를 오래 붙들 이유가 없다), 읽기 타임아웃은
        // LLM 2패스 소요시간(실측 약 5초)을 감안해 설정값을 그대로 쓴다.
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(Math.min(2000, timeoutMs)));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
        SimpleClientHttpRequestFactory translationFactory = new SimpleClientHttpRequestFactory();
        translationFactory.setConnectTimeout(Duration.ofMillis(Math.min(2000, translationTimeoutMs)));
        translationFactory.setReadTimeout(Duration.ofMillis(translationTimeoutMs));
        this.translationRestClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(translationFactory)
                .build();
        log.info("[AiEngine] 클라이언트 초기화 - baseUrl={} factCheckEnabled={} summaryEnabled={} "
                        + "transcriptDiffEnabled={} translationEnabled={} timeoutMs={} translationTimeoutMs={}",
                baseUrl, factCheckEnabled, summaryEnabled, transcriptDiffEnabled, translationEnabled, timeoutMs,
                translationTimeoutMs);
    }

    /**
     * 테스트용 생성자. 다른 패키지의 테스트가 이 클래스를 상속해 스텁을 만들 수 있도록
     * protected 로 둔다. 프로덕션 코드에서는 사용하지 않는다.
     */
    protected AiEngineClient(RestClient restClient, boolean factCheckEnabled) {
        this(restClient, factCheckEnabled, factCheckEnabled);
    }

    /** 테스트용 생성자. 팩트체크와 종합 분석을 따로 켜고 끌 때 쓴다. */
    protected AiEngineClient(RestClient restClient, boolean factCheckEnabled, boolean summaryEnabled) {
        this(restClient, factCheckEnabled, summaryEnabled, factCheckEnabled);
    }

    /** 테스트용 생성자. 과거 콜 대조까지 따로 켜고 끌 때 쓴다. */
    protected AiEngineClient(RestClient restClient, boolean factCheckEnabled, boolean summaryEnabled,
                             boolean transcriptDiffEnabled) {
        this(restClient, factCheckEnabled, summaryEnabled, transcriptDiffEnabled, false);
    }

    /** 테스트용 생성자. 번역까지 따로 켜고 끌 때 쓴다. */
    protected AiEngineClient(RestClient restClient, boolean factCheckEnabled, boolean summaryEnabled,
                             boolean transcriptDiffEnabled, boolean translationEnabled) {
        this.restClient = restClient;
        this.translationRestClient = restClient;
        this.factCheckEnabled = factCheckEnabled;
        this.summaryEnabled = summaryEnabled;
        this.transcriptDiffEnabled = transcriptDiffEnabled;
        this.translationEnabled = translationEnabled;
    }

    /** 대조 응답의 일시적 실패 사유(ai-engine transcript_diff_service). 이 응답은 기억하지 않는다. */
    static final java.util.Set<String> TRANSIENT_DIFF_WARNINGS =
            java.util.Set.of("historical_transcript_diff_llm_failed", "key_statements_lookup_failed");

    /** 기억해 둘 응답 수 상한. 시연 스크립트 한 편(수십 세그먼트)의 수십 배라 넉넉하다. */
    static final int MEMO_MAX_ENTRIES = 2_000;

    /**
     * 같은 요청에 대한 AI 응답(대조 · 번역 · 종합 판단)을 기억해 다시 쓸지. 반복 방송(같은 스크립트를 하루 종일 재생)에서
     * 호출을 첫 회차로 줄이려고 켠다. 요청이 같으면 결과도 같은 것으로 보며, 실패(empty)와 쓸 수 없는 응답은 기억하지
     * 않는다. 팩트체크는 엔진이 상태를 가져 여기서 기억하지 않고 CallAnalysisService 가 회차 단위로 다룬다.
     */
    @Value("${ai-engine.response-memo-enabled:false}")
    private volatile boolean memoEnabled;

    private final Map<Object, Object> memo = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<Object, Object> eldest) {
                    return size() > MEMO_MAX_ENTRIES;
                }
            });

    /** 테스트용. */
    void setMemoEnabled(boolean memoEnabled) {
        this.memoEnabled = memoEnabled;
    }

    public boolean isResponseMemoEnabled() {
        return memoEnabled;
    }

    @SuppressWarnings("unchecked")
    private <T> Optional<T> memoized(Object key, Predicate<T> worthKeeping, Supplier<Optional<T>> call) {
        if (!memoEnabled) {
            return call.get();
        }
        Object hit = memo.get(key);
        if (hit != null) {
            return Optional.of((T) hit);
        }
        Optional<T> result = call.get();
        result.filter(worthKeeping).ifPresent(value -> memo.put(key, value));
        return result;
    }

    public boolean isFactCheckEnabled() {
        return factCheckEnabled;
    }

    public boolean isSummaryEnabled() {
        return summaryEnabled;
    }

    public boolean isTranscriptDiffEnabled() {
        return transcriptDiffEnabled;
    }

    public boolean isTranslationEnabled() {
        return translationEnabled;
    }

    /**
     * 확정된 어닝콜 문장 1개를 제출한다.
     *
     * <p>AI Engine 은 ticker 별 3문장 버퍼를 유지하므로 <b>같은 ticker 의 호출은 순서대로
     * 직렬화되어야 한다.</b> 순서가 뒤집히면 sequence 역행으로 REJECTED 가 나고 해당 문장이
     * 버려진다. 호출자 책임이다.
     *
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty.
     */
    public Optional<LiveFactCheckModels.BatchResponse> submitSentence(LiveFactCheckModels.SentenceRequest request) {
        // 팩트체크는 여기서 기억하지 않는다. 엔진이 종목 버퍼(상태)를 가져서, 일부 문장만 기억에서 꺼내 쓰면 버퍼가
        // 어긋난다. 회차 단위 녹화 · 재생은 CallAnalysisService 가 맡는다.
        if (!factCheckEnabled) {
            return Optional.empty();
        }
        try {
            LiveFactCheckModels.BatchResponse response = restClient.post()
                    .uri(SENTENCE_PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(LiveFactCheckModels.BatchResponse.class);
            if (response == null) {
                log.warn("[AiEngine] 빈 응답 - ticker={} sequence={}", request.ticker(), request.sentenceSequence());
                return Optional.empty();
            }
            return Optional.of(response);
        } catch (Exception e) {
            // 시연 중단을 막기 위해 모든 예외를 흡수한다. 원인은 로그로만 남긴다.
            log.warn("[AiEngine] 팩트체크 호출 실패 - ticker={} sequence={} error={}",
                    request.ticker(), request.sentenceSequence(), e.toString());
            return Optional.empty();
        }
    }

    /**
     * 어닝콜 전문을 넘겨 LLM 종합 판단을 받는다 (Contract 9.6).
     *
     * <p>리뷰 모델까지 태우므로 팩트체크 한 배치보다 느리다. 재생 스레드에서 부르지 말 것.
     *
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty.
     */
    public Optional<EarningsSummaryModels.AnalyzeResponse> analyze(EarningsSummaryModels.AnalyzeRequest request) {
        // 가격(market_data)은 회차마다 달라지므로 기억 키에서 뺀다. 같은 전문이면 첫 판단을 다시 쓴다.
        Object key = List.of("analyze", new EarningsSummaryModels.AnalyzeRequest(
                request.ticker(), request.prompt(), request.needsReview(), null));
        return memoized(key, EarningsSummaryModels.AnalyzeResponse::hasAnalysis,
                () -> post(ANALYZE_PATH, request, EarningsSummaryModels.AnalyzeResponse.class, request.ticker(), "종합 판단"));
    }

    /**
     * 회피 탐지 · 연쇄 영향 · 손절 계획을 한 번에 받는다 (Contract 9.7).
     *
     * <p>이쪽은 LLM 을 타지 않는 규칙 기반이라 빠르다.
     *
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty.
     */
    public Optional<EarningsSummaryModels.IntelligenceResponse> earningsIntelligence(
            EarningsSummaryModels.IntelligenceRequest request) {
        // 엔진이 근거 검색에 임베딩을 쓰므로 회차마다 부르면 하루 한도를 쓴다. 가격(market_data)은 키에서 빼므로,
        // 기억한 손절 계획의 가격 수준은 첫 회차 시세 기준이다.
        Object key = List.of("intelligence", new EarningsSummaryModels.IntelligenceRequest(request.ticker(),
                request.eventText(), request.question(), request.answer(), request.relatedTickers(), null,
                request.directionHint(), request.confidenceHint(), request.asOfEpoch()));
        return memoized(key, r -> true, () -> post(INTELLIGENCE_PATH, request,
                EarningsSummaryModels.IntelligenceResponse.class, request.ticker(), "종합 인텔리전스"));
    }

    /**
     * 종합 분석 계열 POST 공통 경로.
     *
     * <p>{@link #submitSentence} 와 같은 정책 — 실패를 흡수하고 empty 를 돌려준다.
     * 종합 화면 한 장 때문에 어닝콜 재생 종료가 막히면 안 된다.
     */
    private <T> Optional<T> post(String path, Object body, Class<T> responseType, String ticker, String label) {
        if (!summaryEnabled) {
            return Optional.empty();
        }
        try {
            T response = restClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(responseType);
            if (response == null) {
                log.warn("[AiEngine] {} 빈 응답 - ticker={}", label, ticker);
                return Optional.empty();
            }
            return Optional.of(response);
        } catch (Exception e) {
            log.warn("[AiEngine] {} 호출 실패 - ticker={} error={}", label, ticker, e.toString());
            return Optional.empty();
        }
    }

    /**
     * 현재 발언 한 토막을 직전 콜의 같은 주제 발언과 대조한다.
     *
     * <p>팩트체크가 <b>뉴스</b>를 근거로 삼는 것과 달리 이쪽은 <b>같은 회사의 직전 콜</b>이
     * 근거다. 확정 숫자가 맞는지가 아니라 지난 분기와 말이 달라졌는지를 본다.
     *
     * <p>{@link #submitSentence} 와 달리 문장을 버퍼링하지 않으므로 호출 순서에 제약이 없다.
     * 다만 LLM 을 타므로 재생 스레드에서 부르지 말 것.
     *
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty. 직전 콜을 못 찾은 경우는
     *         실패가 아니라 {@code available=false} 응답으로 온다.
     */
    public Optional<TranscriptDiffModels.DiffResponse> transcriptDiff(TranscriptDiffModels.DiffRequest request) {
        // 일시적 실패(LLM · 핵심 발언 조회 실패)만 빼고 기억한다. "근거 약함" · "주제 무관" · "직전 콜 없음" 은 같은
        // 데이터면 회차마다 같은 결과라 다시 물어도 호출만 쓴다.
        return memoized(List.of("transcript-diff", request),
                r -> r.warnings() == null || r.warnings().stream().noneMatch(TRANSIENT_DIFF_WARNINGS::contains),
                () -> callTranscriptDiff(request));
    }

    private Optional<TranscriptDiffModels.DiffResponse> callTranscriptDiff(TranscriptDiffModels.DiffRequest request) {
        if (!transcriptDiffEnabled) {
            return Optional.empty();
        }
        try {
            TranscriptDiffModels.DiffResponse response = restClient.post()
                    .uri(TRANSCRIPT_DIFF_PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(TranscriptDiffModels.DiffResponse.class);
            if (response == null) {
                log.warn("[AiEngine] 과거 콜 대조 빈 응답 - ticker={}", request.ticker());
                return Optional.empty();
            }
            return Optional.of(response);
        } catch (Exception e) {
            log.warn("[AiEngine] 과거 콜 대조 호출 실패 - ticker={} error={}", request.ticker(), e.toString());
            return Optional.empty();
        }
    }

    /**
     * 세그먼트(또는 세그먼트 묶음)를 한국어로 번역한다 (Contract 9.10).
     *
     * <p>LLM 을 타므로 자막 발행 스레드에서 부르지 말 것.
     *
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty. 번역 실패는 {@code available=false}
     *         응답으로 온다.
     */
    public Optional<TranscriptTranslationModels.TranslateResponse> translate(
            TranscriptTranslationModels.TranslateRequest request) {
        // call_id 는 회차마다 다르므로 기억 키에서 뺀다. 응답에는 call_id 가 없다.
        Object key = List.of("translate", new TranscriptTranslationModels.TranslateRequest(
                request.ticker(), "", request.sequence(), request.text(), request.terms()));
        return memoized(key, TranscriptTranslationModels.TranslateResponse::hasText, () -> callTranslate(request));
    }

    private Optional<TranscriptTranslationModels.TranslateResponse> callTranslate(
            TranscriptTranslationModels.TranslateRequest request) {
        if (!translationEnabled) {
            return Optional.empty();
        }
        try {
            TranscriptTranslationModels.TranslateResponse response = translationRestClient.post()
                    .uri(TRANSCRIPT_TRANSLATE_PATH)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(TranscriptTranslationModels.TranslateResponse.class);
            if (response == null) {
                log.warn("[AiEngine] 번역 빈 응답 - ticker={} sequence={}", request.ticker(), request.sequence());
                return Optional.empty();
            }
            return Optional.of(response);
        } catch (Exception e) {
            log.warn("[AiEngine] 번역 호출 실패 - ticker={} sequence={} error={}",
                    request.ticker(), request.sequence(), e.toString());
            return Optional.empty();
        }
    }

    /**
     * 근거 저장소 준비 상태를 확인한다 (Contract 9.8).
     *
     * <p>임베딩 호출 없이 개수만 세므로 빠르다. 재생 시작 버튼 경로에서 동기로 불러도 된다.
     *
     * @param asOfEpochSecond 기준 시각. 과거 콜을 재생할 때는 그 콜의 시각을 넘겨야 한다.
     * @return 응답. 비활성화되었거나 호출이 실패하면 empty.
     */
    public Optional<EarningsSummaryModels.EvidenceReadiness> evidenceReadiness(String ticker, Long asOfEpochSecond) {
        if (!summaryEnabled && !factCheckEnabled) {
            return Optional.empty();
        }
        try {
            EarningsSummaryModels.EvidenceReadiness response = restClient.get()
                    .uri(uriBuilder -> {
                        uriBuilder.path(READINESS_PATH).queryParam("ticker", ticker);
                        if (asOfEpochSecond != null) {
                            uriBuilder.queryParam("as_of", asOfEpochSecond);
                        }
                        return uriBuilder.build();
                    })
                    .retrieve()
                    .body(EarningsSummaryModels.EvidenceReadiness.class);
            return Optional.ofNullable(response);
        } catch (Exception e) {
            // 확인 자체가 실패한 것은 재생을 막을 이유가 아니다. 경고만 못 띄운다.
            log.warn("[AiEngine] 근거 준비 확인 실패 - ticker={} error={}", ticker, e.toString());
            return Optional.empty();
        }
    }
}
