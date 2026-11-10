/** 실서버 주소. 개발 중에는 `.env.development.local` 의 VITE_BACKEND_URL 로 로컬 백엔드를 가리킨다. */
export const DEFAULT_BACKEND_URL = 'https://api.logothea.com'

export function backendUrl(raw: string | undefined = import.meta.env.VITE_BACKEND_URL): string {
  return (raw && raw.trim() ? raw.trim() : DEFAULT_BACKEND_URL).replace(/\/+$/, '')
}

/** 터미널과 같은 네이티브 WebSocket 엔드포인트. http → ws, https → wss. */
export function stompUrl(base: string): string {
  return base.replace(/^http/, 'ws') + '/ws-native'
}
