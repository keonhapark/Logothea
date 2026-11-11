import { useEffect, useState } from 'react'
import { ipc, IPC_CHANNELS } from '../lib/ipc'
import { DEMO_TICKER } from '../constants/demo'
import type { SpeakerProfile } from '../types/speakerProfile'

/**
 * 이 종목 콜 화면에 참가자 명부가 있는지.
 *
 * 명부 엔드포인트(Contract 7.8)는 종목을 받지 않고 시연 스크립트 한 벌의 명부만 돌려준다.
 * 다른 종목에서도 부르면 그 콜과 무관한 시연 종목 참가자가 발화자 버튼에 뜬다.
 */
export function hasSpeakerRoster(ticker: string | null): boolean {
  return ticker === DEMO_TICKER
}

/**
 * useSpeakerProfiles — 콜 참가자 명부 조회.
 *
 * 명부는 회차 내내 바뀌지 않으므로 트레이딩 룸 진입 시 한 번만 가져온다.
 * 실패하거나 명부가 비면 빈 배열 — 호출 측은 그때 프로필 진입점을 감춘다.
 *
 * 시연 종목이 아니면 묻지 않고 빈 배열을 돌려준다(`hasSpeakerRoster`). 여러 콜의 명부를
 * 다루게 되면 그때 엔드포인트에 ticker 파라미터를 추가하고 여기서 함께 보내야 한다.
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
      .invoke<SpeakerProfile[]>(IPC_CHANNELS.DEMO_EARNINGS_SPEAKERS)
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
