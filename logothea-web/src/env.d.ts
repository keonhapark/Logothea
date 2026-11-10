/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 백엔드 주소. 없으면 https://api.logothea.com */
  readonly VITE_BACKEND_URL?: string
  /** 개발 서버 전용 토큰. 배포용 빌드에서는 읽지 않고, 설정돼 있으면 빌드가 멈춘다. */
  readonly VITE_DEV_ACCESS_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
