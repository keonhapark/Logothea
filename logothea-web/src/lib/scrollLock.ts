/**
 * 뒤 화면 스크롤 잠금. iOS Safari 는 body 의 overflow:hidden 만으로는 터치 스크롤을 막지 못해
 * body 를 고정하고 스크롤 위치를 top 으로 옮겨 둔다. 시트와 첫 방문 안내가 함께 써서 겹쳐 잠가도 되게 센다.
 */
let depth = 0
let savedY = 0

export function lockScroll(): () => void {
  if (depth++ === 0) {
    savedY = window.scrollY
    const body = document.body.style
    body.position = 'fixed'
    body.top = `-${savedY}px`
    body.left = '0'
    body.right = '0'
    body.overflow = 'hidden'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--depth > 0) return
    const body = document.body.style
    body.position = ''
    body.top = ''
    body.left = ''
    body.right = ''
    body.overflow = ''
    window.scrollTo(0, savedY)
  }
}
