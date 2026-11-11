package com.earningwhisperer.domain.earnings;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Runs before ApplicationReadyEvent/FMP startup sync, including when no FMP key is configured. */
@Component
@RequiredArgsConstructor
@Slf4j
@Order(1)
public class EarningsCalendarStartup implements ApplicationRunner {

    private final EarningsCalendarService earningsCalendarService;

    @Override
    public void run(ApplicationArguments args) {
        // A failure rolls back the transaction and fails startup rather than reporting a successful repair.
        earningsCalendarService.applyVerifiedOverrides();
        log.info("[EarningsCalendarCorrection] startup complete");
    }
}
