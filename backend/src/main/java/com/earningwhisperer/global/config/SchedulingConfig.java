package com.earningwhisperer.global.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;

/**
 * {@code @Scheduled} 작업 전용 스레드 풀.
 *
 * <p>{@code @EnableWebSocketMessageBroker} 가 {@code messageBrokerTaskScheduler} 를 등록하면 Spring Boot 는
 * 기본 {@code taskScheduler} 를 만들지 않고, {@code @Scheduled} 작업이 브로커 풀(코어 수만큼, t3.small 에서 2개)에서
 * 돈다. 이 풀은 STOMP heart-beat 와 SockJS 도 쓰므로, 몇 분씩 블로킹하는 동기화 작업이 겹치면 heart-beat 가
 * 멈추고 클라이언트가 연결을 끊는다. 그래서 {@code @Scheduled} 를 이 풀로 따로 돌린다.
 *
 * <p>크기 기본값 2 는 분리 전과 같은 동시 실행 수다. 이름을 지정해 두어 다른 곳에서 {@code TaskScheduler} 를
 * 타입으로 주입받을 때 브로커 풀과 헷갈리지 않게 한다.
 */
@Configuration
public class SchedulingConfig implements SchedulingConfigurer {

    static final String THREAD_NAME_PREFIX = "scheduling-";

    private final ThreadPoolTaskScheduler scheduledJobsTaskScheduler;

    public SchedulingConfig(@Qualifier("scheduledJobsTaskScheduler") ThreadPoolTaskScheduler scheduledJobsTaskScheduler) {
        this.scheduledJobsTaskScheduler = scheduledJobsTaskScheduler;
    }

    @Bean(name = "scheduledJobsTaskScheduler")
    static ThreadPoolTaskScheduler scheduledJobsTaskScheduler(@Value("${app.scheduling.pool-size:2}") int poolSize) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(poolSize);
        scheduler.setThreadNamePrefix(THREAD_NAME_PREFIX);
        return scheduler;
    }

    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        registrar.setTaskScheduler(scheduledJobsTaskScheduler);
    }
}
