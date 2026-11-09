/**
 * 종합 판단의 촉매 유형 → 한국어 (docs/design/screens/call.md 종합 판단).
 *
 * 엔진의 촉매 유형은 LLM 이 쓰는 자유 문자열이다. `EARNINGS_GUIDANCE_UPGRADE` 같은 코드도 오고
 * `Earnings Guidance Disappointment` 같은 영어 문구도 온다. 대문자 · 밑줄 표기로 맞춘 뒤 아는 코드는 표에서,
 * 모르는 코드는 단어마다 옮겨 잇는다. 옮기지 못하는 단어가 하나라도 있으면 원값을 그대로 보여 준다.
 */

const CATALYST_LABELS: Record<string, string> = {
  EARNINGS_REPORT: '실적 발표',
  EARNINGS_GROWTH: '실적 성장',
  EARNINGS_BEAT: '실적 상회',
  EARNINGS_MISS: '실적 미달',
  EARNINGS_GUIDANCE_UPGRADE: '가이던스 상향',
  EARNINGS_GUIDANCE_DOWNGRADE: '가이던스 하향',
  GUIDANCE: '가이던스',
  GUIDANCE_UP: '가이던스 상향',
  GUIDANCE_DOWN: '가이던스 하향',
  GUIDANCE_HOLD: '가이던스 유지',
  MARGIN_EXPANSION: '마진 개선',
  MARGIN_COMPRESSION: '마진 악화',
  PRODUCT_LAUNCH: '신제품',
  PRODUCT_NEWS: '제품 소식',
  OPERATIONAL_EXEC: '사업 실행',
  MACRO: '거시 환경',
  MACRO_COMMENTARY: '거시 환경 언급',
  RESTRUCTURING: '구조조정',
  REGULATORY_RISK: '규제 위험',
  UNCLASSIFIED: '분류 안 됨',
}

const WORD_LABELS: Record<string, string> = {
  EARNINGS: '실적',
  GUIDANCE: '가이던스',
  REVENUE: '매출',
  SALES: '매출',
  MARGIN: '마진',
  PROFIT: '이익',
  GROWTH: '성장',
  BEAT: '상회',
  MISS: '미달',
  UPGRADE: '상향',
  DOWNGRADE: '하향',
  RAISE: '상향',
  CUT: '하향',
  UP: '상향',
  DOWN: '하향',
  HOLD: '유지',
  DISAPPOINTMENT: '실망',
  SURPRISE: '서프라이즈',
  EXPANSION: '개선',
  COMPRESSION: '악화',
  RISK: '위험',
}

export function catalystLabel(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (CATALYST_LABELS[code]) return CATALYST_LABELS[code]
  const words = code.split('_').filter(Boolean)
  if (words.length > 0 && words.every((w) => WORD_LABELS[w])) return words.map((w) => WORD_LABELS[w]).join(' ')
  return raw
}
