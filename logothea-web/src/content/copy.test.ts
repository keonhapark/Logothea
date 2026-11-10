import { describe, expect, it } from 'vitest'
import { TEAM, memberLabel } from './copy'

describe('팀 소개', () => {
  it('실명이 있으면 `실명 (아이디)`, 없으면 아이디만', () => {
    expect(memberLabel({ github: 'yytss3', name: '전현규' })).toBe('전현규 (yytss3)')
    expect(memberLabel({ github: 'dheorb' })).toBe('dheorb')
    expect(memberLabel({ github: 'dheorb', name: '  ' })).toBe('dheorb')
  })

  it('역할별 GitHub 아이디', () => {
    expect(TEAM.map((g) => [g.role, g.members.map((m) => m.github)])).toEqual([
      ['기획 · 서버 · 터미널', ['keonhapark']],
      ['AI 분석', ['james10419', 'yytss3']],
      ['데이터 수집', ['dheorb']],
    ])
  })
})
