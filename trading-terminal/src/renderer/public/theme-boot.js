/*
 * 첫 프레임 테마. 화면을 그리기 전에 <html data-theme> 을 정해 시작할 때 다른 테마가 잠깐 보이지 않게 한다.
 *
 * CSP 가 인라인 스크립트를 막아(script-src 'self') 파일로 둔다. 모듈이 아니라서 src/lib/theme.ts 를 불러올 수 없어
 * 저장 키와 값 목록을 따로 적었다. 바꿀 때 그 파일과 같이 바꾼다. 이후 전환은 src/renderer/lib/theme.ts 가 맡는다.
 */
;(function () {
  var choice = 'system'
  try {
    var saved = window.localStorage.getItem('logothea.theme')
    if (saved === 'system' || saved === 'light' || saved === 'dark') choice = saved
  } catch (e) {
    // 저장소를 읽지 못하면 기본값(시스템 설정 따름)
  }
  // matchMedia 가 없으면 다크(src/renderer/lib/theme.ts 와 같은 기본)
  var dark =
    choice === 'dark' ||
    (choice === 'system' && (!window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches))
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
