/**
 * 배포용 빌드에 들어가면 안 되는 값을 막는다.
 *
 * VITE_ 로 시작하는 환경 변수는 번들에 문자열로 박혀 누구나 읽을 수 있다. 개발 토큰이 그렇게 공개되지 않도록
 * 배포용 빌드에서 설정돼 있으면 멈춘다. 백엔드 주소가 평문(http)이어도 멈춘다 — 토큰이 평문으로 오간다.
 */

const LOCAL_HOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/

export function assertBuildEnv(env: Record<string, string | undefined>): void {
  if (env.VITE_DEV_ACCESS_TOKEN?.trim()) {
    throw new Error(
      '[build] VITE_DEV_ACCESS_TOKEN 이 설정된 채로 배포용 빌드를 하려 합니다. 토큰이 공개 번들에 들어갑니다.\n' +
        '  개발 토큰은 .env.development.local 에 두면 배포용 빌드에서 읽히지 않습니다.',
    )
  }
  const url = env.VITE_BACKEND_URL?.trim()
  if (url && !/^https:/i.test(url) && !LOCAL_HOST_PATTERN.test(url)) {
    throw new Error(`[build] VITE_BACKEND_URL 이 평문입니다: ${url}`)
  }
}
