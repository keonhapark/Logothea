package com.earningwhisperer.infrastructure.demo;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("DemoLoopRunner 반복 방송")
class DemoLoopRunnerTest {

    private static final long PAUSE = 180_000;

    private DemoEarningsCallService demo;
    private DemoLoopRunner runner;
    private long now = 1_000_000;

    @BeforeEach
    void setUp() {
        demo = mock(DemoEarningsCallService.class);
        runner = new DemoLoopRunner(demo, "", PAUSE);
        setNow(now);
    }

    private void setNow(long millis) {
        now = millis;
        runner.setClock(Clock.fixed(Instant.ofEpochMilli(millis), ZoneOffset.UTC));
    }

    private static DemoEarningsCallService.StartResult started(String callId) {
        return new DemoEarningsCallService.StartResult(DemoEarningsCallService.StartResult.Outcome.STARTED,
                "WMT", callId, 24, 6000, null, null);
    }

    private static DemoEarningsCallService.Status running() {
        return new DemoEarningsCallService.Status("WMT", "c", 3, 24);
    }

    @Test
    @DisplayName("기동 뒤 첫 확인에서 바로 스크립트 기본 종목으로 시작한다")
    void startsImmediately() {
        when(demo.start(null)).thenReturn(started("c1"));

        runner.tick();

        verify(demo).start(null);
    }

    @Test
    @DisplayName("재생 중이면 시작하지 않고, 끝난 뒤 쉬는 시간이 지나야 새 회차를 시작한다")
    void waitsPauseAfterPlayback() {
        when(demo.start(any())).thenReturn(started("c1"), started("c2"));
        runner.tick();                                   // 1회차 시작

        when(demo.status("WMT")).thenReturn(Optional.of(running()));
        runner.tick();                                   // 재생 중
        verify(demo, times(1)).start(any());

        when(demo.status("WMT")).thenReturn(Optional.empty());
        setNow(now + 5_000);
        runner.tick();                                   // 끝난 것을 처음 봄
        setNow(now + PAUSE - 1);
        runner.tick();                                   // 아직 쉬는 중
        verify(demo, times(1)).start(any());

        setNow(now + 1);
        runner.tick();                                   // 쉬는 시간 지남
        verify(demo, times(2)).start(any());
        verify(demo, times(1)).start("WMT");
    }

    @Test
    @DisplayName("스크립트를 못 읽으면 쉬는 시간만큼 기다렸다 다시 시도한다")
    void retriesAfterPauseOnScriptError() {
        when(demo.start(null)).thenReturn(new DemoEarningsCallService.StartResult(
                DemoEarningsCallService.StartResult.Outcome.SCRIPT_UNAVAILABLE, null, null, 0, 0, "no script", null));

        runner.tick();
        setNow(now + PAUSE - 1);
        runner.tick();
        verify(demo, times(1)).start(null);

        setNow(now + 1);
        runner.tick();
        verify(demo, times(2)).start(null);
    }

    @Test
    @DisplayName("이미 다른 쪽이 재생 중이면 그 회차를 따라가고 새로 시작하지 않는다")
    void alreadyRunning() {
        when(demo.start(null)).thenReturn(new DemoEarningsCallService.StartResult(
                DemoEarningsCallService.StartResult.Outcome.ALREADY_RUNNING, "WMT", "terminal", 0, 0, "running", null));
        when(demo.status("WMT")).thenReturn(Optional.of(running()));

        runner.tick();
        runner.tick();

        verify(demo, times(1)).start(null);
        verify(demo, never()).start("WMT");
    }

    @Test
    @DisplayName("첫 시작 전에는 종목 없는 요청만, 시작 뒤에는 그 종목(대소문자 무관)만 맡는다")
    void controlsLoopTicker() {
        org.assertj.core.api.Assertions.assertThat(runner.controls(null)).isTrue();
        org.assertj.core.api.Assertions.assertThat(runner.controls("WMT")).isFalse();

        when(demo.start(null)).thenReturn(started("c1"));
        runner.tick();

        org.assertj.core.api.Assertions.assertThat(runner.controls("wmt")).isTrue();
        org.assertj.core.api.Assertions.assertThat(runner.controls("ORCL")).isFalse();
    }
}
