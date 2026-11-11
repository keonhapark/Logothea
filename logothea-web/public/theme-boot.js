/*
 * 첫 프레임 테마. 화면을 그리기 전에 <html data-theme> 을 정해 시작할 때 다른 테마가 잠깐 보이지 않게 한다.
 * 터미널 src/renderer/public/theme-boot.js 와 같은 방식이다. 모듈이 아니라 src/app/theme.ts 를 불러올 수 없어
 * 저장 키와 값 목록을 따로 적었다(터미널 src/lib/theme.ts 의 THEME_STORAGE_KEY). 바꿀 때 같이 바꾼다.
 */
;(function () {
  var choice = 'system'
  try {
    var saved = window.localStorage.getItem('logothea.theme')
    if (saved === 'system' || saved === 'light' || saved === 'dark') choice = saved
  } catch (e) {
    // 저장소를 읽지 못하면 기기 설정을 따른다
  }
  var dark =
    choice === 'dark' ||
    (choice === 'system' && (!window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches))
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
