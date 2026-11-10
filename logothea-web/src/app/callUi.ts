import { create } from 'zustand'

export type CallTab = 'transcript' | 'diff' | 'ask' | 'verdict'

/**
 * 콜 화면의 화면 상태. 탭을 옮겨도 남아야 하는 것(고른 탭 · 질문 범위)과 다른 탭에서 자막으로 옮겨 올 때
 * 쓰는 것(focus)을 둔다. 대조 · 질문에서 `자막에서 보기` 를 누르면 자막 탭으로 바꾸고 그 발언을 밝힌다.
 */
interface CallUiState {
  tab: CallTab
  /** 질문 범위로 고른 발언. null 이면 콜 전체. */
  anchorSequence: number | null
  /** 자막에서 밝힐 발언. nonce 로 같은 발언을 다시 눌러도 다시 밝힌다. */
  focus: { sequence: number; nonce: number } | null
  setTab: (tab: CallTab) => void
  askAbout: (sequence: number) => void
  clearAnchor: () => void
  focusSequence: (sequence: number) => void
  /** 새 회차 — 지난 회차 발언을 가리키는 범위 · 밝힘을 버린다. 고른 탭은 둔다. */
  resetRound: () => void
}

export const useCallUi = create<CallUiState>((set) => ({
  tab: 'transcript',
  anchorSequence: null,
  focus: null,
  setTab: (tab) => set({ tab }),
  askAbout: (sequence) => set({ tab: 'ask', anchorSequence: sequence }),
  clearAnchor: () => set({ anchorSequence: null }),
  focusSequence: (sequence) => set({ tab: 'transcript', focus: { sequence, nonce: Date.now() } }),
  resetRound: () => set({ anchorSequence: null, focus: null }),
}))
