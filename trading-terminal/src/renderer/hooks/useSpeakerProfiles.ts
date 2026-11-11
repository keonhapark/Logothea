import { useEffect, useState } from 'react'
import { ipc, IPC_CHANNELS } from '../lib/ipc'
import { isDemoTicker } from '../constants/demo'
import type { SpeakerProfile } from '../types/speakerProfile'

/**
 * 이 종목 콜 화면에 참가자 명부가 있는지.
 *
 * 명부는 시연 대본에만 있다(Contract 7.8). 대본이 없는 종목을 물으면 백엔드는 기본 대본의 명부를 돌려주므로,
 * 그 콜과 무관한 시연 종목 참가자가 발화자 버튼에 뜬다.
 */
export function hasSpeakerRoster(ticker: string | null): boolean {
  return isDemoTicker(ticker)
}

/**
 * useSpeakerProfiles — 콜 참가자 명부 조회.
 *
 * 명부는 회차 내내 바뀌지 않으므로 트레이딩 룸 진입 시 한 번만 가져온다.
 * 실패하거나 명부가 비면 빈 배열 — 호출 측은 그때 프로필 진입점을 감춘다.
 *
 * 시연 종목이 아니면 묻지 않고 빈 배열을 돌려준다(`hasSpeakerRoster`). 시연 종목이면 종목을 실어 그 대본의
 * 명부를 받는다.
 */
export function useSpeakerProfiles(ticker: string | null): readonly SpeakerProfile[] {
  const [profiles, setProfiles] = useState<readonly SpeakerProfile[]>([])

  useEffect(() => {
    if (!hasSpeakerRoster(ticker)) {
      setProfiles([])
      return
    }
    let cancelled = false
    ipc
      .invoke<SpeakerProfile[]>(IPC_CHANNELS.DEMO_EARNINGS_SPEAKERS, { ticker })
      .then((list) => {
        if (!cancelled) setProfiles(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setProfiles([])
      })
    return () => {
      cancelled = true
    }
  }, [ticker])

  return profiles
}
