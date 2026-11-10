import { useBroadcastView } from '../app/broadcast'

/** 콜 화면 자리. 실제 화면(자막 · 대조 · 질문 · 판단)은 다음 PR 에서 들어온다. */
export default function CallPlaceholder() {
  const view = useBroadcastView()
  return (
    <main className="screen">
      <h1 className="large-title" tabIndex={-1}>콜</h1>
      <section className="cloud panel state">
        <p>
          {view.kind === 'live'
            ? `지금 방송 중입니다. 자막 ${view.segments.length}문장을 받았습니다.`
            : view.kind === 'between'
              ? '다음 회차를 준비하고 있습니다.'
              : '방송 정보를 아직 받지 못했습니다.'}
        </p>
        <p className="fine">콜 화면은 준비 중입니다.</p>
      </section>
    </main>
  )
}
