import { createAssistantStream } from './assistant'
import { createDevTokenProvider, type AuthProvider } from './auth'
import { backendUrl, stompUrl } from './config'
import { createHttpClient } from './http'
import { installPageLifecycle } from './pageLifecycle'
import { createStompBridge } from './stomp'
import { createWebIpc } from './webIpc'
import { createFixtureHttp, createFixtureStomp } from '../dev/fixtures'
import { IPC_CHANNELS } from '@terminal/lib/ipcChannels'
import { isRetiredPayload } from '../app/callFeed'

/**
 * 앱 전체가 함께 쓰는 연결 묶음. 터미널 훅 · store 는 `bridge/ipc.ts` 를 거쳐 여기의 webIpc 를 받는다.
 *
 * 인증을 바꿔 끼우는 자리는 아래 `auth` 한 줄이다. 게스트 토큰 발급 API 가 생기면 그 구현으로 바꾼다.
 * 개발 토큰은 개발 서버에서만 읽는다. `import.meta.env.DEV` 가 false 인 빌드에서는 이 분기가 지워져
 * 토큰 문자열이 번들에 남지 않는다(vite.config.ts 의 빌드 가드가 한 번 더 막는다).
 */
const auth: AuthProvider = createDevTokenProvider(
  import.meta.env.DEV ? import.meta.env.VITE_DEV_ACCESS_TOKEN : undefined,
)

/**
 * 개발 서버에서 `VITE_FIXTURES=1` 이면 가짜 서버(dev/fixtures.ts)로 그린다. 배포용 빌드에서는 DEV 가 false 라
 * 이 분기와 가짜 서버 코드가 번들에서 빠진다.
 */
const useFixtures = import.meta.env.DEV && import.meta.env.VITE_FIXTURES === '1'

const baseUrl = backendUrl()
export const http = useFixtures ? createFixtureHttp() : createHttpClient({ baseUrl, auth })
export const stomp = useFixtures ? createFixtureStomp() : createStompBridge({ url: stompUrl(baseUrl), auth })
export const assistant = createAssistantStream({ http })
/** 끝난 회차의 늦은 대조 · 팩트체크는 store 에 넣지 않는다(app/callFeed.ts). */
const LATE_ROUND_CHANNELS: ReadonlySet<string> = new Set([IPC_CHANNELS.TRANSCRIPT_DIFF_RECEIVED, IPC_CHANNELS.FACTCHECK_BATCH_RECEIVED])
export const webIpc = createWebIpc({
  http,
  stomp,
  assistant,
  dropMessage: (channel, payload) => LATE_ROUND_CHANNELS.has(channel) && isRetiredPayload(payload),
})

// 테스트(node)에는 document 가 없다
if (typeof document !== 'undefined') installPageLifecycle(stomp)
