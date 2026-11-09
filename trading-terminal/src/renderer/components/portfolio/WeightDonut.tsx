// from https://github.com/Seokwoooo/lucian-uxui-prompt/blob/42396145b375a17712fd738ca0e1d977556c0b73/src/elements/097-donut-hover-expand.html @ 42396145b375a17712fd738ca0e1d977556c0b73 · MIT (c) 2026 Seokwoooo
import { useEffect, useMemo, useRef, useState } from 'react'
import { donutSlices, type DonutInput, type DonutSlice } from '../../lib/portfolioDonut'
import { usd } from './format'

interface WeightDonutProps {
  holdings: readonly DonutInput[]
  cash: number
  /** 종목 조각 · 범례를 누르면 그 종목 브리핑을 연다. */
  onOpenTicker: (ticker: string) => void
}

const R = 80
const GAP = 3

/** 종목 조각의 색. 앱의 네 색 돌 다음은 잉크로 둔다. 기타 · 현금은 옅은 잉크다. */
const STOCK_COLORS = ['var(--lapis)', 'var(--olive)', 'var(--porphyra)', 'var(--gold)', 'rgb(var(--ink-rgb) / 0.55)']

function pct(w: number): string {
  const v = w * 100
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`
}

/**
 * 포트폴리오 비중 도넛 (W5, donut-hover-expand).
 *
 * 보유 표의 `비중` 열을 원으로 본다. 조각이나 범례에 올리면 그 조각이 바깥으로 나오고 가운데에 금액 ·
 * 비중이 뜬다. 종목은 누르면 브리핑을 연다. 처음 그릴 때 조각이 차례로 차오른다.
 */
export default function WeightDonut({ holdings, cash, onOpenTicker }: WeightDonutProps) {
  const slices = useMemo(() => donutSlices(holdings, cash), [holdings, cash])
  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices])
  const [active, setActive] = useState<string | null>(null)

  // 색은 순위가 아니라 종목에 붙인다. 시세가 움직여 순위가 바뀌어도 색이 서로 바뀌지 않는다.
  const colorOf = useRef(new Map<string, number>())
  for (const sl of slices) {
    if (sl.kind === 'stock' && !colorOf.current.has(sl.key)) {
      const used = new Set(colorOf.current.values())
      let k = 0
      while (used.has(k)) k++
      colorOf.current.set(sl.key, k)
    }
  }
  const sliceColor = (sl: DonutSlice): string => {
    if (sl.kind === 'cash') return 'rgb(var(--ink-rgb) / 0.14)'
    if (sl.kind === 'other') return 'rgb(var(--ink-rgb) / 0.3)'
    return STOCK_COLORS[(colorOf.current.get(sl.key) ?? 0) % STOCK_COLORS.length]
  }

  // 조각 비율을 종목별로 0 에서 목표까지 키운다. 값이 바뀌면 지금 모양에서 새 모양으로 옮겨 간다.
  // 시세 폴링으로 배열만 새로 오고 비중이 사실상 같으면(0.01%p 단위) 다시 움직이지 않는다.
  const signature = slices.map((sl) => `${sl.key}:${sl.weight.toFixed(4)}`).join('|')
  const slicesRef = useRef(slices)
  slicesRef.current = slices
  const [fr, setFr] = useState<ReadonlyMap<string, number>>(() => new Map())
  const frRef = useRef(fr)
  frRef.current = fr
  useEffect(() => {
    const list = slicesRef.current
    const from = new Map(list.map((sl) => [sl.key, frRef.current.get(sl.key) ?? 0]))
    const target = new Map(list.map((sl) => [sl.key, sl.weight]))
    const first = frRef.current.size === 0
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFr(target)
      return
    }
    const dur = first ? 1100 : 600
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      setFr(
        new Map(
          list.map((sl, i) => {
            const kk = first ? Math.max(0, Math.min(1, (k - i * 0.1) / 0.6)) : k
            const e = kk < 0.5 ? 4 * kk * kk * kk : 1 - Math.pow(-2 * kk + 2, 3) / 2
            const f = from.get(sl.key) ?? 0
            return [sl.key, f + ((target.get(sl.key) ?? 0) - f) * e]
          }),
        ),
      )
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // 비중이 실제로 바뀔 때만 다시 움직인다. 조각 목록은 slicesRef 로 최신 값을 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // 포인터가 나가도 키보드 포커스가 범례에 있으면 그 조각을 계속 보인다.
  const legendRef = useRef<HTMLUListElement>(null)
  const clearUnlessFocused = () => {
    const el = document.activeElement as HTMLElement | null
    const key = el && legendRef.current?.contains(el) ? el.dataset.key ?? null : null
    setActive(key)
  }

  if (slices.length === 0) {
    return <p className="px-6 py-10 text-center text-[13px] text-ink-3">보유 종목과 현금이 없어 비중을 그릴 수 없습니다.</p>
  }

  const activeSlice = slices.find((sl) => sl.key === active) ?? null
  // 조각마다 떨어진 호(arc)로 그린다. 겹친 원에 점선을 두는 방식은 마우스 판정이 점선을 무시할 수 있다.
  const CX = 108
  const gapAngle = GAP / R
  let a0 = -Math.PI / 2
  const arcs = slices.map((sl) => {
    const sweep = (fr.get(sl.key) ?? 0) * Math.PI * 2
    const start = a0 + gapAngle / 2
    const end = a0 + sweep - gapAngle / 2
    const mid = a0 + sweep / 2
    a0 += sweep
    if (end - start <= 0.001) return { sl, d: null, mid }
    const pt = (a: number) => `${(CX + R * Math.cos(a)).toFixed(2)} ${(CX + R * Math.sin(a)).toFixed(2)}`
    const d = `M ${pt(start)} A ${R} ${R} 0 ${end - start > Math.PI ? 1 : 0} 1 ${pt(end)}`
    return { sl, d, mid }
  })

  return (
    <div className="h-full min-h-0 flex items-center gap-10 px-8 pb-6">
      <div className="relative w-[216px] h-[216px] shrink-0" onPointerLeave={clearUnlessFocused}>
        <svg viewBox="0 0 216 216" className="w-full h-full overflow-visible" aria-hidden="true">
          <circle cx={CX} cy={CX} r={R} fill="none" strokeWidth="26" style={{ stroke: 'rgb(var(--ink-rgb) / 0.06)' }} />
          {arcs.map(({ sl, d, mid }) => {
            if (!d) return null
            const on = sl.key === active
            return (
              <path
                key={sl.key}
                d={d}
                fill="none"
                onPointerEnter={() => setActive(sl.key)}
                onClick={() => sl.kind === 'stock' && onOpenTicker(sl.key)}
                className={`donut-seg ${sl.kind === 'stock' ? 'cursor-pointer' : ''}`}
                style={{
                  stroke: sliceColor(sl),
                  strokeWidth: on ? 34 : 26,
                  opacity: active && !on ? 0.38 : 1,
                  transform: on ? `translate(${(Math.cos(mid) * 7).toFixed(2)}px, ${(Math.sin(mid) * 7).toFixed(2)}px)` : undefined,
                }}
              />
            )
          })}
        </svg>
        <div className="absolute inset-[44px] flex flex-col items-center justify-center text-center pointer-events-none" aria-hidden="true">
          <span key={activeSlice?.key ?? 'total'} className="donut-center flex flex-col items-center">
            <span className="text-[12px] text-ink-3 max-w-[120px] truncate">{activeSlice ? activeSlice.label : '총자산'}</span>
            <span className="mt-0.5 text-[19px] font-semibold text-ink-1 tabular-nums">
              {usd(activeSlice ? activeSlice.value : total)}
            </span>
            {activeSlice && <span className="mt-0.5 text-[12px] font-semibold text-ink-2 tabular-nums">{pct(activeSlice.weight)}</span>}
          </span>
        </div>
      </div>

      <ul
        className="flex-1 min-w-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 content-center"
        aria-label="자산 비중"
        ref={legendRef}
        onPointerLeave={clearUnlessFocused}
      >
        {slices.map((s) => {
          const body = (
            <>
              <i className="w-3 h-3 shrink-0 rounded-[4px]" style={{ background: sliceColor(s) }} aria-hidden="true" />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[13px] text-ink-1 truncate">
                  {s.kind === 'stock' && <span className="num font-semibold mr-1.5">{s.key}</span>}
                  {s.kind === 'stock' ? <span className="text-ink-3">{s.label}</span> : s.label}
                </span>
                <span className="text-[12px] text-ink-3 tabular-nums">{usd(s.value)}</span>
              </span>
              <span className="text-[13px] font-semibold text-ink-1 tabular-nums">{pct(s.weight)}</span>
            </>
          )
          const cls = `w-full flex items-center gap-3 h-12 px-3 rounded-[14px] text-left transition-colors ${
            s.key === active ? 'bg-wash/[0.07]' : ''
          }`
          return (
            <li key={s.key} onPointerEnter={() => setActive(s.key)}>
              {s.kind === 'stock' ? (
                <button
                  type="button"
                  data-key={s.key}
                  className={`${cls} hover:bg-wash/[0.07]`}
                  onFocus={() => setActive(s.key)}
                  onBlur={() => setActive((a) => (a === s.key ? null : a))}
                  onClick={() => onOpenTicker(s.key)}
                  aria-label={`${s.key} ${s.label} ${usd(s.value)}, 총자산의 ${pct(s.weight)}. 브리핑 열기`}
                >
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
