package com.earningwhisperer.infrastructure.broadcast;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 종목마다 가장 최근 회차에 발행한 STOMP 메시지를 그대로 남겨 둔다. 중간에 들어온 관람객이 앞부분을 한 번에 받는
 * 스냅샷(api-spec 7.8)의 원본이다.
 *
 * <ul>
 *   <li>새 callId 의 자막이 오면 그 종목의 기록을 새 회차로 바꾼다. 지난 회차 기록은 다음 회차 첫 자막이 올 때까지
 *       남아, 회차 사이에 들어온 관람객이 끝난 회차 전체와 종합 판단을 받는다.</li>
 *   <li>자막이 아닌 메시지는 지금 회차의 callId 와 같을 때만 남긴다. 늦게 도착한 지난 회차 결과가 섞이지 않는다.</li>
 *   <li>원소는 발행한 payload 객체 그대로라, 스냅샷 JSON 이 STOMP 메시지와 같은 모양이다.</li>
 * </ul>
 * 메모리에만 있으므로 재시작하면 비어 있다. {@link #IDLE_TTL} 동안 새 메시지가 없는 회차는 새 회차가 열릴 때 지운다.
 */
@Component
public class CallBroadcastStore {

    /** 한 회차에서 종류마다 남길 상한. 1시간 실시간 콜(약 360 세그먼트)을 넉넉히 담는다. */
    static final int MAX_PER_KIND = 2_000;

    /** 이 시간 동안 아무것도 기록되지 않은 회차는 지운다. 실시간 콜 종목이 시즌 내내 쌓이지 않게 한다. */
    static final java.time.Duration IDLE_TTL = java.time.Duration.ofHours(6);

    private java.time.Clock clock = java.time.Clock.systemUTC();

    void setClock(java.time.Clock clock) {
        this.clock = clock;
    }

    public enum Kind { SEGMENT, TRANSLATION, FACT_CHECK, DIFF, EVALUATION }

    private final Map<String, Round> rounds = new ConcurrentHashMap<>();

    /**
     * 발행한 메시지를 남긴다.
     *
     * @param sequence 자막이면 세그먼트 번호(같은 번호는 덮어씀). 그 밖에는 쓰지 않는다.
     */
    public void record(Kind kind, String ticker, String callId, int sequence, Object payload) {
        if (ticker == null || callId == null || payload == null) {
            return;
        }
        String key = key(ticker);
        Round round;
        if (kind == Kind.SEGMENT) {
            Round existing = rounds.get(key);
            if (existing == null || !existing.callId.equals(callId)) {
                purgeIdle();
            }
            round = rounds.compute(key, (k, current) ->
                    current != null && current.callId.equals(callId) ? current : new Round(callId));
        } else {
            round = rounds.get(key);
            if (round == null || !round.callId.equals(callId)) {
                return;
            }
        }
        round.lastUpdatedMillis = clock.millis();
        round.add(kind, sequence, payload);
    }

    private void purgeIdle() {
        long cutoff = clock.millis() - IDLE_TTL.toMillis();
        rounds.entrySet().removeIf(entry -> entry.getValue().lastUpdatedMillis < cutoff);
    }

    public Optional<Snapshot> snapshot(String ticker) {
        Round round = rounds.get(key(ticker));
        return round == null ? Optional.empty() : Optional.of(round.toSnapshot());
    }

    private static String key(String ticker) {
        return ticker == null ? "" : ticker.trim().toUpperCase();
    }

    /** 한 회차의 기록. 원소는 STOMP payload 그대로다. */
    public record Snapshot(String callId, List<Object> segments, List<Object> translations, List<Object> factChecks,
                           List<Object> diffs, Object evaluation) {
    }

    private static final class Round {
        final String callId;
        final TreeMap<Integer, Object> segments = new TreeMap<>();
        final List<Object> translations = new ArrayList<>();
        final List<Object> factChecks = new ArrayList<>();
        final List<Object> diffs = new ArrayList<>();
        Object evaluation;
        volatile long lastUpdatedMillis;

        Round(String callId) {
            this.callId = callId;
        }

        synchronized void add(Kind kind, int sequence, Object payload) {
            switch (kind) {
                case SEGMENT -> {
                    if (segments.size() < MAX_PER_KIND || segments.containsKey(sequence)) {
                        segments.put(sequence, payload);
                    }
                }
                case TRANSLATION -> addBounded(translations, payload);
                case FACT_CHECK -> addBounded(factChecks, payload);
                case DIFF -> addBounded(diffs, payload);
                case EVALUATION -> evaluation = payload;
            }
        }

        private static void addBounded(List<Object> list, Object payload) {
            if (list.size() < MAX_PER_KIND) {
                list.add(payload);
            }
        }

        synchronized Snapshot toSnapshot() {
            return new Snapshot(callId, List.copyOf(segments.values()), List.copyOf(translations),
                    List.copyOf(factChecks), List.copyOf(diffs), evaluation);
        }
    }
}
