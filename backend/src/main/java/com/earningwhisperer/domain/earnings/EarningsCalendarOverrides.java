package com.earningwhisperer.domain.earnings;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Reviewed demo dates only: matching never expands to an entire day or month. */
@Component
public class EarningsCalendarOverrides {

    private final List<Entry> entries;
    private final Map<Key, Entry> byTime;

    @Autowired
    public EarningsCalendarOverrides(
            ObjectMapper objectMapper,
            @Value("${earnings-calendar.demo-overrides.enabled:true}") boolean enabled) {
        this(objectMapper, enabled, new ClassPathResource("data/earnings-calendar-overrides.json"));
    }

    EarningsCalendarOverrides(ObjectMapper objectMapper, boolean enabled, Resource resource) {
        if (!enabled) {
            entries = List.of();
            byTime = Map.of();
            return;
        }

        try (InputStream input = resource.getInputStream()) {
            Document document = objectMapper.readerFor(Document.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(input);
            if (document == null || document.entries() == null) {
                throw new IllegalArgumentException("Override entries are required");
            }
            entries = List.copyOf(document.entries());
            Map<Key, Entry> index = new HashMap<>();
            for (Entry entry : entries) {
                add(index, entry, entry.scheduledAt());
                for (Instant replaced : entry.replaces()) {
                    add(index, entry, replaced);
                }
            }
            byTime = Map.copyOf(index);
        } catch (IOException | IllegalArgumentException | NullPointerException ex) {
            throw new IllegalStateException("Invalid earnings calendar override resource", ex);
        }
    }

    public List<Entry> entries() {
        return entries;
    }

    public Optional<Entry> find(String ticker, Instant at) {
        if (ticker == null || at == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(byTime.get(new Key(ticker, at)));
    }

    private static void add(Map<Key, Entry> index, Entry entry, Instant at) {
        if (index.putIfAbsent(new Key(entry.ticker(), at), entry) != null) {
            throw new IllegalArgumentException("Duplicate override key: " + entry.ticker() + " / " + at);
        }
    }

    private record Key(String ticker, Instant at) {}

    private record Document(String verifiedOn, List<Entry> entries) {}

    /**
     * @param confirmed 회사가 날짜 · 시각을 공식 발표했는지. 생략하면 true. 아직 발표 전이라 직전 콜 시각과 업체 예상
     *                  날짜로 채운 행사는 false 로 두어 화면이 "예상" 으로 보이게 한다.
     */
    public record Entry(String ticker, Instant scheduledAt, String marketSession,
                        List<Instant> replaces, String sourceUrl, Boolean confirmed) {
        public Entry {
            if (ticker == null || !ticker.matches("[A-Z][A-Z0-9.\\-]{0,9}")) {
                throw new IllegalArgumentException("A valid uppercase ticker is required");
            }
            if (scheduledAt == null || replaces == null || replaces.stream().anyMatch(value -> value == null)) {
                throw new IllegalArgumentException("Canonical and replacement timestamps are required");
            }
            if (marketSession == null || !Set.of("bmo", "amc", "dmh").contains(marketSession)) {
                throw new IllegalArgumentException("Invalid market session");
            }
            if (sourceUrl == null || sourceUrl.isBlank()) {
                throw new IllegalArgumentException("An official source URL is required");
            }
            URI source = URI.create(sourceUrl);
            if (!"https".equals(source.getScheme()) || source.getHost() == null || source.getUserInfo() != null) {
                throw new IllegalArgumentException("Source must be an HTTPS URL without credentials");
            }
            replaces = List.copyOf(replaces);
        }

        public Entry(String ticker, Instant scheduledAt, String marketSession,
                     List<Instant> replaces, String sourceUrl) {
            this(ticker, scheduledAt, marketSession, replaces, sourceUrl, null);
        }

        public boolean isConfirmed() {
            return confirmed == null || confirmed;
        }
    }
}
