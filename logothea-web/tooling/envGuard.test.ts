import { describe, expect, it } from 'vitest'
import { assertBuildEnv } from './envGuard'

describe('assertBuildEnv', () => {
  it('개발 토큰이 있으면 배포용 빌드를 멈춘다', () => {
    expect(() => assertBuildEnv({ VITE_DEV_ACCESS_TOKEN: 'eyJ...' })).toThrow(/VITE_DEV_ACCESS_TOKEN/)
  })

  it('평문 원격 주소는 멈추고 https · 로컬은 통과시킨다', () => {
    expect(() => assertBuildEnv({ VITE_BACKEND_URL: 'http://43.200.26.70:8082' })).toThrow(/평문/)
    expect(() => assertBuildEnv({ VITE_BACKEND_URL: 'https://api.logothea.com' })).not.toThrow()
    expect(() => assertBuildEnv({ VITE_BACKEND_URL: 'http://localhost:8082' })).not.toThrow()
    expect(() => assertBuildEnv({})).not.toThrow()
  })

  it('공백뿐인 토큰은 없는 것으로 본다', () => {
    expect(() => assertBuildEnv({ VITE_DEV_ACCESS_TOKEN: '  ' })).not.toThrow()
  })

  it.each(['http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'http://localhost@evil.com', 'http://evil.com/localhost'])(
    '로컬처럼 보이는 원격 주소는 막는다: %s',
    (url) => {
      expect(() => assertBuildEnv({ VITE_BACKEND_URL: url })).toThrow(/평문/)
    },
  )
})
