import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 화면 코드에 색을 직접 적지 않는다(#213). 테마마다 바뀌는 색은 styles/tokens.css 의 토큰을 쓴다.
 * 직접 적으면 라이트 테마에서 그 자리만 다크 색으로 남는다.
 *
 * 예외: 브랜드 고유색(OAuth 버튼 · 회사 로고 색)과, 두 테마 모두 흰색인 유리 반사광(`rgb(255 255 255 / a)`).
 */
const ROOT = join(__dirname, '..', '..', 'renderer')
const ALLOW_FILES = ['components/auth/OAuthButton.tsx', 'constants/companyMeta.ts']

const RULES: { name: string; re: RegExp }[] = [
  { name: 'white · black 투명도 클래스', re: /\b(?:bg|border|text|ring|divide|outline|from|via|to|fill|stroke|shadow)-(?:white|black)\/[\d[]/ },
  // 흰 반사광(rgb(255 255 255 / a))만 예외로 둔다
  { name: '숫자 rgb() · rgba()', re: /rgba?\(\s*(?!255 255 255 \/)\d/ },
  { name: 'hex 색', re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/ },
  { name: '임의 그림자 값', re: /shadow-\[[^\]]*rgba?\(/ },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'assets' ? [] : sourceFiles(path)
    return /\.(tsx|ts)$/.test(name) ? [path] : []
  })
}

describe('화면 코드의 색', () => {
  it('토큰 대신 색을 직접 적은 곳이 없다', () => {
    const found: string[] = []
    for (const path of sourceFiles(ROOT)) {
      const rel = relative(ROOT, path)
      if (ALLOW_FILES.includes(rel)) continue
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        // 이슈 번호(#112 등, 네 자리까지)는 hex 가 아니다. 숫자로만 된 여섯 자리 이상은 색으로 본다
        const code = line.replace(/#\d{1,4}\b/g, '')
        for (const { name, re } of RULES) if (re.test(code)) found.push(`${rel}:${i + 1} ${name} — ${line.trim().slice(0, 80)}`)
      })
    }
    expect(found).toEqual([])
  })
})
