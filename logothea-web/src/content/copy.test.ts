import { describe, expect, it } from 'vitest'
import { TEAM } from './copy'

describe('팀 소개', () => {
  it('역할별 GitHub 아이디만 쓰고 실명은 두지 않는다', () => {
    expect(TEAM.map((g) => [g.role, g.github])).toEqual([
      ['기획 · 서버 · 터미널', ['keonhapark']],
      ['AI 분석', ['james10419', 'yytss3']],
      ['데이터 수집', ['dheorb']],
    ])
  })
})
