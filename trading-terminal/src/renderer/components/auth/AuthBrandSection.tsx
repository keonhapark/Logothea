import lockupDarkUrl from '../../assets/logo/logothea-lockup-dark.svg'
import lockupLightUrl from '../../assets/logo/logothea-lockup-light.svg'

/**
 * AuthBrandSection — 로그인 · 키 등록 카드 위의 브랜드 영역.
 * 가로 조합(심볼 + 워드마크)을 테마에 맞춰 쓴다 — 다크는 흰 워드마크, 라이트는 먹색 워드마크. 원본은 docs/design/logo/ 이고
 * 크기 · 여백 규칙은 docs/design/brand.md "로고와 앱 아이콘" 을 따른다.
 */
export default function AuthBrandSection() {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* 높이 40px — 가로 조합 최소 24px 이상. 둘레 여백은 심볼 높이의 1/4(10px) 이상 */}
      <img src={lockupDarkUrl} alt="Logothea" className="theme-dark-only h-10 w-auto m-2.5 select-none" draggable={false} />
      <img src={lockupLightUrl} alt="Logothea" className="theme-light-only h-10 w-auto m-2.5 select-none" draggable={false} />
      <p className="text-ink-3 text-[13px] whitespace-nowrap">어닝콜을 들으며 판단하고 주문합니다</p>
    </div>
  )
}
