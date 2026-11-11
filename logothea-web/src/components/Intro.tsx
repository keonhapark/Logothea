import { useEffect, useRef, useState } from 'react'
import { DISCLAIMER, INTRO } from '../content/copy'
import { lockScroll } from '../lib/scrollLock'

const SEEN_KEY = 'logothea.web.intro-seen'

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 첫 방문 안내. 홈 위에 한 번만 뜨는 읽는 유리 카드(전체 덮개)다. `시작하기` 로 닫고 본 사실을 남긴다.
 * 저장이 막혀 있으면 매번 떠도 된다(명세).
 */
export default function Intro() {
  const [open, setOpen] = useState(() => !readSeen())
  const titleRef = useRef<HTMLHeadingElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    titleRef.current?.focus({ preventScroll: true })
    return lockScroll()
  }, [open])

  if (!open) return null
  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // 저장하지 못하면 다음 방문 때 다시 뜬다
    }
    setOpen(false)
  }
  return (
    <>
      <div className="intro-scrim" aria-hidden="true" />
      <div
        className="intro read"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          // 누를 것이 하나뿐이라 Tab 은 버튼에 머문다
          if (e.key === 'Tab') {
            e.preventDefault()
            buttonRef.current?.focus()
          }
        }}
      >
        <h1 id="intro-title" ref={titleRef} tabIndex={-1} className="brand-mark">
          Logothea<small>{INTRO.tagline}</small>
        </h1>
        <p className="intro-body">{INTRO.body}</p>
        <button ref={buttonRef} type="button" className="cta tint" onClick={close}>
          시작하기
        </button>
        <p className="fine">{DISCLAIMER}</p>
      </div>
    </>
  )
}
