import { useEffect, useState } from 'react'
import { DEMO_TICKER } from '@terminal/renderer/constants/demo'
import { useLiveTranscript } from '@terminal/renderer/hooks/useLiveTranscript'
import { useFactCheck } from '@terminal/renderer/hooks/useFactCheck'
import { useTranscriptDiff } from '@terminal/renderer/hooks/useTranscriptDiff'
import { useTranscriptTranslation } from '@terminal/renderer/hooks/useTranscriptTranslation'
import { useEarningsSummary } from '@terminal/renderer/hooks/useEarningsSummary'
import { useSpeakerProfiles } from '@terminal/renderer/hooks/useSpeakerProfiles'
import { ipc, IPC_CHANNELS } from './bridge/ipc'
import type { WsStatus } from './data/stomp'
import { stomp } from './data/runtime'

/**
 * 연결 확인용 임시 화면. 모바일 화면(PR 2)이 들어오면 대체한다.
 * 터미널 훅을 그대로 써서 STOMP · REST 가 store 까지 들어오는지 숫자로만 보여 준다.
 */
export default function App() {
  const ticker = tickerFromQuery() ?? DEMO_TICKER
  const [wsStatus, setWsStatus] = useState<WsStatus>(stomp.status)
  useEffect(() => ipc.on(IPC_CHANNELS.WS_STATUS_CHANGED, (p) => setWsStatus((p as { status: WsStatus }).status)), [])

  const { segments } = useLiveTranscript(ticker)
  const { claims } = useFactCheck(ticker)
  const { items: diffs } = useTranscriptDiff(ticker)
  const { items: translations, glossaryStatus } = useTranscriptTranslation(ticker)
  const { summary } = useEarningsSummary(ticker)
  const speakers = useSpeakerProfiles(ticker)

  const rows: [string, string | number][] = [
    ['종목', ticker],
    ['STOMP', wsStatus],
    ['자막', segments.length],
    ['번역 문단', translations.length],
    ['용어 사전', glossaryStatus],
    ['팩트체크', claims.length],
    ['직전 콜 대조', diffs.length],
    ['종합 판단', summary ? '받음' : '없음'],
    ['화자 명부', speakers.length],
  ]

  return (
    <main className="mx-auto max-w-md p-4 font-sans text-sm">
      <h1 className="mb-3 text-base font-semibold">Logothea 연결 확인</h1>
      <dl className="grid grid-cols-2 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {segments.length > 0 && (
        <p className="mt-4 text-neutral-700">{segments[segments.length - 1].text}</p>
      )}
    </main>
  )
}

function tickerFromQuery(): string | null {
  const value = new URLSearchParams(window.location.search).get('ticker')
  return value ? value.toUpperCase() : null
}
