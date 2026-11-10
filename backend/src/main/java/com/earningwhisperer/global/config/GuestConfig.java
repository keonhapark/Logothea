package com.earningwhisperer.global.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** 전시용 웹 게스트 설정 활성화. */
@Configuration
@EnableConfigurationProperties(GuestProperties.class)
public class GuestConfig {
}
