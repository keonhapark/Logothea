package com.earningwhisperer.infrastructure.security;

/**
 * 게스트 토큰으로 인증된 요청의 principal.
 *
 * <p>사용자 요청의 principal 은 {@code Long userId} 다. 게스트는 users 행이 없으므로 다른 타입을 써서,
 * {@code (Long) getPrincipal()} 을 쓰는 컨트롤러에 게스트가 닿으면 조용히 다른 사용자로 처리되지 않고
 * 실패하게 한다. 게스트가 닿을 수 있는 경로는 {@code SecurityConfig} 의 허용 목록뿐이다.
 *
 * @param guestId 게스트 토큰마다 새로 만드는 식별자
 */
public record GuestPrincipal(String guestId) {

    public static final String ROLE = "ROLE_GUEST";

    /** 질의응답 한도 · 잠금 키처럼 사용자 ID 와 같은 자리에 쓰는 문자열. 숫자인 사용자 ID 와 겹치지 않는다. */
    public String key() {
        return "guest:" + guestId;
    }
}
