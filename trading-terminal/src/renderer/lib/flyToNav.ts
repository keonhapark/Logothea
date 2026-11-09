/**
 * 관심 추가 효과 — 누른 자리에서 종목 칩이 곡선을 그리며 사이드바의 메뉴로 날아가 들어간다.
 * product-add-to-cart(ui-shelf)의 방식을 옮겼다. 모션 줄이기를 켰으면 아무것도 하지 않는다.
 *
 * 칩은 React 밖에서 잠깐 붙였다 뗀다. 열린 서랍(z-300) 위로 지나가도록 그보다 위에 둔다.
 */
export function flyToNav(from: Element, label: string, navPath: string): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const target = document.querySelector(`[data-nav="${navPath}"]`)
  if (!target || typeof document.body.animate !== 'function') return

  const a = from.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  const chip = document.createElement('div')
  chip.className = 'fly-chip cloud-s rim'
  chip.textContent = label
  chip.setAttribute('aria-hidden', 'true')
  document.body.append(chip)

  // 칩 가운데가 누른 자리(별) 가운데에서 출발한다
  const x0 = a.left + a.width / 2 - chip.offsetWidth / 2
  const y0 = a.top + a.height / 2 - chip.offsetHeight / 2
  const x1 = b.left + 18
  const y1 = b.top + b.height / 2 - 12
  // 두 점 사이 위쪽으로 휘는 곡선(2차 베지어)
  const cx = (x0 + x1) / 2
  const cy = Math.min(y0, y1) - 120
  const frames: Keyframe[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 - t * 0.35})`, opacity: t > 0.92 ? 0 : 1 })
  }
  const flight = chip.animate(frames, { duration: 750, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
  const done = () => chip.remove()
  flight.onfinish = () => {
    done()
    // 들어간 메뉴가 살짝 흔들려 받았음을 알린다
    target.animate(
      [{ transform: 'none' }, { transform: 'rotate(-3deg) scale(1.04)' }, { transform: 'rotate(2deg)' }, { transform: 'none' }],
      { duration: 420, easing: 'ease-out' },
    )
  }
  flight.oncancel = done
}
