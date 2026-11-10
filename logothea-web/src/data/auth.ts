/**
 * 백엔드 액세스 토큰을 건네는 쪽. http · stomp · assistant 는 이 인터페이스만 본다.
 *
 * 지금은 개발용 고정 토큰뿐이다. 게스트 토큰 발급 API 가 생기면 그것을 부르는 구현을 만들어
 * `runtime.ts` 의 한 줄에서 바꿔 끼운다. 토큰은 메모리에만 두고 쿠키는 쓰지 않는다.
 */
export interface AuthProvider {
  /** 지금 쓸 토큰. 없으면 null — 연결을 시도하지 않는다. */
  getAccessToken(): Promise<string | null>
  /** 서버가 토큰을 거부했을 때 부른다. 새 토큰을 받지 못하면 null — 호출 측은 AUTH_EXPIRED 로 다룬다. */
  refresh(): Promise<string | null>
}

/**
 * 로컬 백엔드에서 로그인해 얻은 토큰을 환경 변수로 넣어 쓰는 개발용 구현.
 * 갱신 수단이 없어 refresh 는 늘 null 이다. 로컬 백엔드를 `--jwt.expiration-ms=86400000` 으로 띄우면
 * 15분마다 토큰을 다시 넣지 않아도 된다.
 */
export function createDevTokenProvider(token: string | undefined): AuthProvider {
  const value = token?.trim() ? token.trim() : null
  return {
    getAccessToken: async () => value,
    refresh: async () => null,
  }
}
