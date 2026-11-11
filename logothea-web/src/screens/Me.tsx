import type { ReactNode } from 'react'
import type { ThemeChoice } from '@terminal/lib/theme'
import { closeSheet, openSheet } from '../app/sheet'
import { setThemeChoice, THEME_LABELS, useThemeChoice } from '../app/theme'
import { usePrefs, type Prefs } from '../app/prefs'
import { ABOUT, LOGIN_NOTICE, SOURCES, TEAM } from '../content/copy'

/** 내 정보. 로그인 카드(안내 시트) · 설정(테마 · 번역 · 용어 밑줄) · 정보(소개 · 팀 소개 · 출처 · 고지). */
export default function Me() {
  return (
    <main className="screen">
      <h1 className="large-title" tabIndex={-1}>내 정보</h1>
      <LoginCard />
      <Settings />
      <Info />
    </main>
  )
}

function LoginCard() {
  return (
    <section className="me cloud" aria-labelledby="login-title">
      <span className="avatar dent" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z" />
        </svg>
      </span>
      <h2 id="login-title">로그인해 주세요</h2>
      <p>로그인하면 증권사 계좌를 연결해 주문 · 포트폴리오 · 관심 종목을 쓸 수 있습니다.</p>
      <button
        type="button"
        className="cta tint"
        onClick={() => openSheet({ title: '로그인', body: () => <p>{LOGIN_NOTICE}</p> })}
      >
        로그인
      </button>
    </section>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grp" aria-label={label}>
      <h2 className="group-label">{label}</h2>
      <ul className="cloud grp-list rows">{children}</ul>
    </section>
  )
}

function Settings() {
  const theme = useThemeChoice()
  const showTranslation = usePrefs((s) => s.showTranslation)
  const glossaryUnderline = usePrefs((s) => s.glossaryUnderline)
  return (
    <Group label="설정">
      <li>
        <button type="button" className="row-btn li" onClick={openThemeSheet} aria-haspopup="dialog">
          <span>화면 테마</span>
          <em>{THEME_LABELS[theme]} ›</em>
        </button>
      </li>
      <SwitchRow label="자막 번역 함께 보기" prefKey="showTranslation" value={showTranslation} />
      <SwitchRow label="용어 밑줄" prefKey="glossaryUnderline" value={glossaryUnderline} />
    </Group>
  )
}

function SwitchRow({ label, prefKey, value }: { label: string; prefKey: keyof Prefs; value: boolean }) {
  const set = usePrefs((s) => s.set)
  const id = `pref-${prefKey}`
  return (
    <li>
      {/* 행 전체가 스위치다. 글자를 눌러도 바뀐다 */}
      <button type="button" role="switch" aria-checked={value} aria-labelledby={id} className="row-btn li" onClick={() => set(prefKey, !value)}>
        <span id={id}>{label}</span>
        <span className="switch" aria-hidden="true" />
      </button>
    </li>
  )
}

function openThemeSheet() {
  openSheet({ title: '화면 테마', body: () => <ThemeOptions /> })
}

function ThemeOptions() {
  const theme = useThemeChoice()
  return (
    <ul className="rows" role="radiogroup" aria-label="화면 테마">
      {(['system', 'light', 'dark'] as ThemeChoice[]).map((choice) => (
        <li key={choice}>
          <button
            type="button"
            role="radio"
            aria-checked={theme === choice}
            className="row-btn li"
            onClick={() => {
              setThemeChoice(choice)
              closeSheet()
            }}
          >
            <span>{THEME_LABELS[choice]}</span>
            {theme === choice && <span aria-hidden="true">✓</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Info() {
  return (
    <Group label="정보">
      <InfoRow label="Logothea 소개" open={() => openSheet({ title: 'Logothea 소개', body: () => ABOUT.map((p) => <p key={p}>{p}</p>) })} />
      <InfoRow label="팀 소개" open={() => openSheet({ title: '팀 소개', body: () => <Team /> })} />
      <InfoRow
        label="데이터 출처 · 고지"
        open={() =>
          openSheet({
            title: '데이터 출처 · 고지',
            body: () => (
              <dl className="sources">
                {SOURCES.map((s) => (
                  <div key={s.title}>
                    <dt>{s.title}</dt>
                    <dd>{s.body}</dd>
                  </div>
                ))}
              </dl>
            ),
          })
        }
      />
    </Group>
  )
}

function InfoRow({ label, open }: { label: string; open: () => void }) {
  return (
    <li>
      <button type="button" className="row-btn li" onClick={open} aria-haspopup="dialog">
        <span>{label}</span>
        <em aria-hidden="true">›</em>
      </button>
    </li>
  )
}

function Team() {
  return (
    <dl className="sources">
      {TEAM.map((group) => (
        <div key={group.role}>
          <dt>{group.role}</dt>
          <dd>{group.github.join(' · ')}</dd>
        </div>
      ))}
    </dl>
  )
}
