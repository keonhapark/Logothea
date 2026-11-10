import terminal from '../trading-terminal/tailwind.config.js'

/**
 * 터미널 tailwind 테마(색 · 글꼴 이름이 tokens.css 변수를 가리킴)를 그대로 쓴다. 터미널에서 옮겨 온 JSX 의
 * `text-ink-3` · `bg-wash/[0.05]` 같은 클래스를 고치지 않고 쓸 수 있다.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: terminal.theme,
  plugins: [],
}
