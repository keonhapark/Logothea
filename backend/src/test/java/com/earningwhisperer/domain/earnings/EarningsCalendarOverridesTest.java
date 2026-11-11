package com.earningwhisperer.domain.earnings;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EarningsCalendarOverridesTest {

    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void packagedDataContainsOnlyTheNineReviewedCompanies() {
        EarningsCalendarOverrides overrides = new EarningsCalendarOverrides(mapper, true);

        assertThat(overrides.entries()).extracting(EarningsCalendarOverrides.Entry::ticker)
                .containsExactly("CSCO", "DIS", "NVDA", "TGT", "WMT", "ADBE", "WFC", "C", "BAC");
        assertThat(overrides.entries()).extracting(EarningsCalendarOverrides.Entry::scheduledAt)
                .containsExactly(
                        Instant.parse("2026-11-12T21:30:00Z"),
                        Instant.parse("2026-11-17T13:30:00Z"),
                        Instant.parse("2026-11-17T22:00:00Z"),
                        Instant.parse("2026-11-18T13:00:00Z"),
                        Instant.parse("2026-11-19T13:00:00Z"),
                        Instant.parse("2026-12-09T22:00:00Z"),
                        Instant.parse("2027-01-14T15:00:00Z"),
                        Instant.parse("2027-01-14T16:00:00Z"),
                        Instant.parse("2027-01-15T13:30:00Z"));
        for (EarningsCalendarOverrides.Entry entry : overrides.entries()) {
            assertThat(overrides.find(entry.ticker(), entry.scheduledAt())).contains(entry);
            for (Instant replaced : entry.replaces()) {
                assertThat(overrides.find(entry.ticker(), replaced)).contains(entry);
            }
        }
    }

    @Test
    void matchingDoesNotExpandBeyondTheExplicitTickerAndInstant() {
        EarningsCalendarOverrides overrides = new EarningsCalendarOverrides(mapper, true);

        assertThat(overrides.find("DIS", Instant.parse("2026-11-12T00:00:00Z"))).isPresent();
        assertThat(overrides.find("DIS", Instant.parse("2026-11-13T00:00:00Z"))).isEmpty();
        assertThat(overrides.find("DIS", Instant.parse("2026-11-12T00:00:00.001Z"))).isEmpty();
        assertThat(overrides.find("DIS", Instant.parse("2026-11-17T13:30:01Z"))).isEmpty();
        assertThat(overrides.find("dis", Instant.parse("2026-11-12T00:00:00Z"))).isEmpty();
        assertThat(overrides.find("COST", Instant.parse("2026-12-10T00:00:00Z"))).isEmpty();
        assertThat(overrides.find("NKE", Instant.parse("2026-12-17T00:00:00Z"))).isEmpty();
        assertThat(overrides.find("AMAT", Instant.parse("2026-11-12T00:00:00Z"))).isEmpty();
        assertThat(overrides.find(null, Instant.parse("2026-11-12T00:00:00Z"))).isEmpty();
        assertThat(overrides.find("DIS", null)).isEmpty();
    }

    @Test
    void disabledOverridesDoNotReadTheResource() {
        EarningsCalendarOverrides overrides = new EarningsCalendarOverrides(
                mapper, false, new ClassPathResource("does-not-exist.json"));

        assertThat(overrides.entries()).isEmpty();
        assertThat(overrides.find("DIS", Instant.parse("2026-11-12T00:00:00Z"))).isEmpty();
    }

    @Test
    void exposedCollectionsCannotBeModified() {
        EarningsCalendarOverrides overrides = new EarningsCalendarOverrides(mapper, true);

        assertThatThrownBy(() -> overrides.entries().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> overrides.entries().get(0).replaces().clear())
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ticker", "scheduledAt", "marketSession", "replaces", "sourceUrl"})
    void missingRequiredFieldsRejectTheResource(String field) throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).remove(field);

        assertInvalid(document);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "dis", " DIS", "DIS!", "TOOLONGTICKER"})
    void invalidTickersRejectTheResource(String ticker) throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).put("ticker", ticker);

        assertInvalid(document);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "am", "BMO", "unknown"})
    void invalidSessionsRejectTheResource(String session) throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).put("marketSession", session);

        assertInvalid(document);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not a URL", "http://example.com/event", "/relative", "https:///event", "https://user@example.com/event"})
    void invalidSourcesRejectTheResource(String source) throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).put("sourceUrl", source);

        assertInvalid(document);
    }

    @ParameterizedTest
    @ValueSource(strings = {"2026-11-17", "2026-11-17T13:30:00", "not-a-time"})
    void invalidOrUnzonedTimesRejectTheResource(String timestamp) throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).put("scheduledAt", timestamp);

        assertInvalid(document);
    }

    @Test
    void duplicateCanonicalOrAliasKeysAcrossEntriesAreRejected() throws Exception {
        ObjectNode document = validDocument();
        ArrayNode entries = (ArrayNode) document.get("entries");
        ObjectNode conflicting = firstEntry(document).deepCopy();
        conflicting.put("scheduledAt", "2026-11-12T00:00:00Z");
        conflicting.set("replaces", mapper.createArrayNode());
        entries.add(conflicting);

        assertInvalid(document);
    }

    @Test
    void duplicateKeysWithinAnEntryAreRejected() throws Exception {
        ObjectNode document = validDocument();
        ((ArrayNode) firstEntry(document).get("replaces")).add("2026-11-17T13:30:00Z");

        assertInvalid(document);
    }

    @Test
    void separateReviewedEventsForTheSameCompanyAreAllowed() throws Exception {
        ObjectNode document = validDocument();
        ObjectNode later = firstEntry(document).deepCopy();
        later.put("scheduledAt", "2027-02-10T13:30:00Z");
        later.set("replaces", mapper.createArrayNode().add("2027-02-10T00:00:00Z"));
        ((ArrayNode) document.get("entries")).add(later);

        assertThat(load(document).entries()).hasSize(2);
    }

    @Test
    void nullReplacementAndNullEntriesAreRejected() throws Exception {
        ObjectNode document = validDocument();
        ((ArrayNode) firstEntry(document).get("replaces")).addNull();
        assertInvalid(document);

        ObjectNode missingEntries = mapper.createObjectNode();
        missingEntries.putNull("entries");
        assertInvalid(missingEntries);
    }

    @Test
    void unknownFieldsAndMalformedJsonFailClosed() throws Exception {
        ObjectNode document = validDocument();
        firstEntry(document).put("extraDate", "2026-11-13T00:00:00Z");
        assertInvalid(document);

        assertThatThrownBy(() -> new EarningsCalendarOverrides(mapper, true,
                new ByteArrayResource("not-json".getBytes(StandardCharsets.UTF_8))))
                .isInstanceOf(IllegalStateException.class);
    }

    private ObjectNode validDocument() throws Exception {
        return (ObjectNode) mapper.readTree("""
                {"verifiedOn":"2026-11-11","entries":[{
                  "ticker":"DIS","scheduledAt":"2026-11-17T13:30:00Z","marketSession":"bmo",
                  "replaces":["2026-11-12T00:00:00Z"],
                  "sourceUrl":"https://investor.thewaltdisneycompany.com/event"
                }]}
                """);
    }

    private ObjectNode firstEntry(ObjectNode document) {
        return (ObjectNode) document.get("entries").get(0);
    }

    private EarningsCalendarOverrides load(ObjectNode document) throws Exception {
        return new EarningsCalendarOverrides(mapper, true, new ByteArrayResource(mapper.writeValueAsBytes(document)));
    }

    private void assertInvalid(ObjectNode document) {
        assertThatThrownBy(() -> load(document)).isInstanceOf(IllegalStateException.class);
    }
}
