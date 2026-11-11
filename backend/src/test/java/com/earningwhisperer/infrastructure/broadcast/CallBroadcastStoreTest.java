package com.earningwhisperer.infrastructure.broadcast;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("CallBroadcastStore")
class CallBroadcastStoreTest {

    private final CallBroadcastStore store = new CallBroadcastStore();

    @Test
    @DisplayName("기록이 없으면 비어 있다")
    void empty() {
        assertThat(store.snapshot("WMT")).isEmpty();
    }

    @Test
    @DisplayName("한 회차의 메시지를 종류별로 남기고, 자막은 번호 순 · 같은 번호는 덮어쓴다")
    void recordsRound() {
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c1", 1, "seg1");
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c1", 0, "seg0");
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c1", 1, "seg1-again");
        store.record(CallBroadcastStore.Kind.TRANSLATION, "WMT", "c1", 0, "tr");
        store.record(CallBroadcastStore.Kind.FACT_CHECK, "WMT", "c1", 0, "fc");
        store.record(CallBroadcastStore.Kind.DIFF, "WMT", "c1", 1, "diff");
        store.record(CallBroadcastStore.Kind.EVALUATION, "WMT", "c1", 0, "eval");

        CallBroadcastStore.Snapshot snapshot = store.snapshot("wmt").orElseThrow();
        assertThat(snapshot.callId()).isEqualTo("c1");
        assertThat(snapshot.segments()).containsExactly("seg0", "seg1-again");
        assertThat(snapshot.translations()).containsExactly("tr");
        assertThat(snapshot.factChecks()).containsExactly("fc");
        assertThat(snapshot.diffs()).containsExactly("diff");
        assertThat(snapshot.evaluation()).isEqualTo("eval");
    }

    @Test
    @DisplayName("지난 회차는 다음 회차의 첫 자막이 올 때까지 남고, 그 뒤 새 회차로 바뀐다")
    void newRoundReplacesOnFirstSegment() {
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c1", 0, "old");
        store.record(CallBroadcastStore.Kind.EVALUATION, "WMT", "c1", 0, "old-eval");

        assertThat(store.snapshot("WMT").orElseThrow().evaluation()).isEqualTo("old-eval");

        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c2", 0, "new");
        CallBroadcastStore.Snapshot snapshot = store.snapshot("WMT").orElseThrow();
        assertThat(snapshot.callId()).isEqualTo("c2");
        assertThat(snapshot.segments()).containsExactly("new");
        assertThat(snapshot.evaluation()).isNull();
    }

    @Test
    @DisplayName("지금 회차가 아닌 callId 의 분석 결과는 남기지 않는다")
    void dropsLateResultsOfOtherRounds() {
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "c2", 0, "new");
        store.record(CallBroadcastStore.Kind.FACT_CHECK, "WMT", "c1", 0, "late-fc");
        store.record(CallBroadcastStore.Kind.EVALUATION, "WMT", "c1", 0, "late-eval");
        store.record(CallBroadcastStore.Kind.TRANSLATION, "NVDA", "x", 0, "no-round");

        CallBroadcastStore.Snapshot snapshot = store.snapshot("WMT").orElseThrow();
        assertThat(snapshot.factChecks()).isEmpty();
        assertThat(snapshot.evaluation()).isNull();
        assertThat(store.snapshot("NVDA")).isEmpty();
    }

    @Test
    @DisplayName("종목마다 따로 남긴다")
    void perTicker() {
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "w", 0, "w0");
        store.record(CallBroadcastStore.Kind.SEGMENT, "NVDA", "n", 0, "n0");

        assertThat(store.snapshot("WMT").orElseThrow().segments()).containsExactly("w0");
        assertThat(store.snapshot("NVDA").orElseThrow().segments()).containsExactly("n0");
    }

    @Test
    @DisplayName("6시간 동안 기록이 없던 회차는 다른 회차가 열릴 때 지운다")
    void purgesIdleRounds() {
        java.time.Instant start = java.time.Instant.parse("2026-11-11T00:00:00Z");
        store.setClock(java.time.Clock.fixed(start, java.time.ZoneOffset.UTC));
        store.record(CallBroadcastStore.Kind.SEGMENT, "CSCO", "live", 0, "c0");

        store.setClock(java.time.Clock.fixed(start.plus(java.time.Duration.ofHours(7)), java.time.ZoneOffset.UTC));
        store.record(CallBroadcastStore.Kind.SEGMENT, "WMT", "w", 0, "w0");

        assertThat(store.snapshot("CSCO")).isEmpty();
        assertThat(store.snapshot("WMT")).isPresent();
    }
}
