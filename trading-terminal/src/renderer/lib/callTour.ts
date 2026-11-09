/** 콜 화면 첫 사용 안내를 본 적이 있는지. 이 기기의 사용자 편의 기억이라 localStorage 에 둔다. */
export const CALL_TOUR_STORAGE_KEY = 'logothea.callTourDone'

export function isCallTourDone(): boolean {
  try {
    return localStorage.getItem(CALL_TOUR_STORAGE_KEY) === '1'
  } catch {
    // 읽지 못하면 본 것으로 둔다. 매번 안내가 뜨는 것보다 낫다.
    return true
  }
}

export function markCallTourDone(): void {
  try {
    localStorage.setItem(CALL_TOUR_STORAGE_KEY, '1')
  } catch {
    // 기억하지 못하면 다음에 한 번 더 뜰 뿐이다
  }
}

/** 설정의 "다시 보기". 다음에 콜 화면에 들어가면 안내가 다시 뜬다. */
export function resetCallTour(): void {
  try {
    localStorage.removeItem(CALL_TOUR_STORAGE_KEY)
  } catch {
    // 지우지 못하면 다시 뜨지 않을 뿐이다
  }
}
