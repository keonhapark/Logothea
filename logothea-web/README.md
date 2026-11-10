# logothea-web

전시회 관람객이 휴대폰으로 Logothea 어닝콜 기능을 체험하는 모바일 웹입니다. `demo.logothea.com` 에 배포할 예정입니다.

실서버(`https://api.logothea.com`)에 직접 붙습니다. 어닝콜 기능과 홈 · 시장 · 종목 브리핑을 담고, 로그인 · 증권사
연동 · 주문 · 포트폴리오 · 관심종목 · 설정은 뺍니다.
화면은 아래 탭 네 개(홈 · 시장 · 콜 · 내 정보)와 아래에서 올라오는 시트로 이루어집니다. 화면 명세는 uiux 세션이
관리합니다. 콜 탭은 아직 자리만 있고 다음 작업에서 채웁니다.

## 구조

trading-terminal 의 어닝콜 store · 훅 · 순수 lib 를 복사하지 않고 그대로 import 해서 씁니다. 이 코드들이 백엔드
응답(snake_case)의 검증 · 변환 · 중복 제거를 맡고 있어서, 복사하면 백엔드 계약이 바뀔 때 웹만 어긋나기 때문입니다.

터미널 화면 코드는 데이터를 전부 `trading-terminal/src/renderer/lib/ipc.ts` 한 곳으로 받습니다. 웹은 빌드 단계에서
그 파일을 `src/bridge/ipc.ts` 로 바꿔 끼우고, 채널 이름을 받아 백엔드 REST · STOMP · SSE 로 직접 보냅니다.
터미널 코드는 고치지 않습니다.

```
src/app/         앱 틀: 경로(History API) · 시트 · 테마 · 설정 · 방송 상태와 앱 단위 구독
src/components/  탭 바 · 첫 방문 안내
src/screens/     홈 · 시장 · 종목 브리핑 · 내 정보
src/styles/      mobile.css — 터미널 토큰 위에 모바일 값과 표면 · 색유리 클래스
src/content/     화면 문구
src/dev/         개발용 가짜 서버(배포용 빌드에서 빠짐)
src/bridge/      터미널 모듈의 웹 대체 파일 (ipc, Toast)
src/data/        브라우저 데이터 연결
  auth.ts          토큰 제공 인터페이스. 게스트 토큰은 여기에 구현을 추가해 runtime.ts 에서 바꿔 끼웁니다
  http.ts          REST. 401 이면 토큰을 한 번 갱신해 다시 보냅니다
  stomp.ts         STOMP. 재연결 시 재구독, 인증 실패 시 갱신 1회 (터미널 StompService 규칙)
  pageLifecycle.ts 화면 잠금 · 탭 전환 · 망 전환 뒤 STOMP 를 새로 붙입니다(모바일에서 소켓이 열린 채 죽는 경우 대비)
  assistant.ts     질의응답 SSE (터미널 AssistantStreamService 규칙)
  webIpc.ts        채널 → REST/STOMP 라우팅 표 (어닝콜 채널)
  marketChannels.ts 홈 · 시장 · 종목 브리핑 채널 (어닝콜 일정, 지수, 종목 목록 · 시세, 종목 상세)
  runtime.ts       위를 묶은 앱 전체 공용 인스턴스
tooling/         Vite 플러그인(터미널 파일 바꿔 끼우기 · 허용 목록)과 빌드 가드
```

연결하는 채널은 두 묶음입니다.

- 어닝콜: 자막 · 팩트체크 · 직전 콜 대조 · 번역 · 종합 판단 구독, 용어 사전, 화자 명부, 질의응답
- 홈 · 시장 · 종목 브리핑: 어닝콜 일정(5분 갱신), 주요 지수, S&P 500 목록, 시세 스냅샷 · 실시간 시세, 종목 상세

실시간으로 밀어 주는 채널(일정 갱신 · 지수 · 시세)은 화면이 듣고 있는 동안에만 폴링하거나 구독합니다.
그 밖의 채널(주문 · 계좌 · 포트폴리오 · KIS · 관심종목 · 설정 · 로그인)은 거절합니다. 시연 재생 시작 · 중지도 거절합니다.
방송은 서버가 돌리고, 관람객 한 명이 멈추면 다른 모든 관람객의 콜이 끊기기 때문입니다.

## 터미널 파일 허용 목록

`tooling/terminalBridge.ts` 가 import 할 수 있는 터미널 파일을 정합니다. 목록 밖의 파일(main · preload · 화면
컴포넌트 등)을 import 하면 빌드가 멈춥니다. Electron 코드가 웹 번들에 섞이지 않게 하려는 것입니다.

- 디렉터리 단위로 허용: `src/lib/`, `src/renderer/{store,hooks,lib,types,constants}/`
- 파일 단위로 허용: `ALLOWED_FILES` — 지금은 `renderer/styles/tokens.css` 와 그 글꼴 두 개
  (`assets/fonts/PretendardVariable.woff2`, `JetBrainsMono-Variable.woff2`)

모바일 화면 작업에서 터미널 디자인 토큰(tailwind 설정, 전역 CSS 의 유리 · 구름 클래스)이나 화면 조각(`diffMeta`,
`CallTimeline`, `RiskBandChart` 등)을 가져오게 되면 `ALLOWED_FILES` 에 파일 단위로 넓힙니다. 디렉터리째 열지
않습니다. 넓힐 때는 uiux 세션에 알립니다.

## 개발

```bash
npm ci
npm run dev        # http://localhost:5173
npm test
npm run typecheck
npm run build
```

로컬 백엔드에 붙어 개발합니다. 백엔드 CORS 기본값에 `http://localhost:5173` 이 들어 있어 따로 설정할 것은 없습니다.
`logothea-web/.env.development.local` 을 만들어 아래 두 값을 넣습니다. 이 파일은 git 에 올라가지 않습니다.

```
VITE_BACKEND_URL=http://localhost:8082
VITE_DEV_ACCESS_TOKEN=<로컬 백엔드 로그인 응답의 access_token>
```

백엔드 없이 화면만 보려면 `.env.development.local` 에 `VITE_FIXTURES=1` 을 둡니다. 개발용 가짜 서버
(`src/dev/fixtures.ts`)가 예시 자막 · 시세 · 일정을 흘려 줍니다. 숫자와 발언은 모두 예시이고, 배포용 빌드에는 들어가지 않습니다.

액세스 토큰 수명이 15분이라, 로컬 백엔드를 `--jwt.expiration-ms=86400000` 인자로 띄우면 토큰을 자주 바꾸지
않아도 됩니다(코드 변경 없음). 개발 토큰은 개발 서버에서만 읽습니다. 배포용 빌드에서 `VITE_DEV_ACCESS_TOKEN`
이 설정돼 있거나 `VITE_BACKEND_URL` 이 평문 원격 주소면 빌드가 멈춥니다.

## 배포 전에 필요한 백엔드 변경

게스트 토큰 발급, 게스트 권한 제한, 반복 방송, 중간 입장 시 앞부분 채우기, 질의응답 횟수 제한, CORS 허용 원본
추가가 필요합니다. 이 변경들이 들어가기 전에는 실서버에 공개 배포하지 않습니다.
