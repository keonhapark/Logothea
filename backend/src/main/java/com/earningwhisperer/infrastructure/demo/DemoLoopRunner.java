package com.earningwhisperer.infrastructure.demo;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

/**
 * 전시용 반복 방송. 시연 콜을 끝까지 재생하고, 종합 판단이 나올 시간을 포함해 {@code loop-pause-ms} 쉰 뒤 새
 * 회차(새 callId)로 다시 재생하기를 계속한다. {@code demo.earnings-call.loop.enabled=true} 일 때만 만든다.
 *
 * <ul>
 *   <li>기동 직후 첫 확인에서 바로 시작한다.</li>
 *   <li>재생 중이면 아무것도 하지 않는다. 터미널이 같은 종목을 시작하려 하면 지금처럼 409 다.</li>
 *   <li>누가 중지해도 쉬는 시간이 지나면 다시 시작한다. 반복을 멈추려면 설정을 끄고 재시작한다.</li>
 *   <li>회차마다 같은 스크립트라, {@code ai-engine.response-memo-enabled=true} 면 두 번째 회차부터 AI Engine 을
 *       부르지 않고 첫 회차 결과를 같은 시점에 다시 발행한다.</li>
 * </ul>
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "demo.earnings-call.loop.enabled", havingValue = "true")
public class DemoLoopRunner {

    private final DemoEarningsCallService demo;
    private final long pauseMs;
    /** 반복할 종목. 비어 있으면 스크립트 기본 종목이며, 첫 시작 뒤 그 값으로 채운다. */
    private volatile String ticker;
    private Clock clock = Clock.systemUTC();

    /** 재생이 끝난 것을 처음 본 시각. 재생 중이면 null. */
    private Long idleSince;
    private boolean everStarted;

    public DemoLoopRunner(DemoEarningsCallService demo,
                          @Value("${demo.earnings-call.loop.ticker:}") String ticker,
                          @Value("${demo.earnings-call.loop.pause-ms:180000}") long pauseMs) {
        this.demo = demo;
        this.ticker = ticker == null || ticker.isBlank() ? null : ticker.trim().toUpperCase();
        this.pauseMs = Math.max(0, pauseMs);
        log.info("[DemoLoop] 반복 방송 켜짐 - ticker={} pause={}ms", this.ticker == null ? "(스크립트 기본)" : this.ticker,
                this.pauseMs);
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    @Scheduled(initialDelayString = "${demo.earnings-call.loop.initial-delay-ms:5000}",
            fixedDelayString = "${demo.earnings-call.loop.check-interval-ms:5000}")
    synchronized void tick() {
        if (ticker != null && demo.status(ticker).isPresent()) {
            idleSince = null;
            return;
        }
        long now = clock.millis();
        if (idleSince == null) {
            // 처음에는 기다리지 않고 바로 시작한다. 그 뒤로는 재생이 끝난 것을 본 시각부터 잰다.
            idleSince = everStarted ? now : now - pauseMs;
        }
        if (now - idleSince < pauseMs) {
            return;
        }
        DemoEarningsCallService.StartResult result = demo.start(ticker);
        switch (result.outcome()) {
            case STARTED -> {
                ticker = result.ticker();
                everStarted = true;
                idleSince = null;
                log.info("[DemoLoop] 새 회차 시작 - ticker={} call_id={}", result.ticker(), result.callId());
            }
            case ALREADY_RUNNING -> {
                ticker = result.ticker();
                idleSince = null;
            }
            case SCRIPT_UNAVAILABLE -> {
                // 쉬는 시간만큼 기다렸다가 다시 시도한다. 매 확인마다 실패 로그를 쌓지 않는다.
                idleSince = now;
                log.error("[DemoLoop] 시작하지 못했습니다 - {}", result.message());
            }
        }
    }
}
