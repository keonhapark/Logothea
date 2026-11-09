/** @type {import('tailwindcss').Config} */
// 값의 기준은 src/renderer/styles/tokens.css 다. 여기서는 그 변수를 클래스 이름으로 노출한다.
// 예전 이름(surface · accent · buy · sell 등)은 화면 코드가 그대로 쓰도록 남기고 값만 토큰을 가리키게 했다.
// 채널(`--x-rgb`)을 가리키는 색은 `bg-ok/15` 같은 투명도 수식이 동작한다. 완성 값(`var(--x)`)을 가리키는 색은
// 이미 투명도가 들어 있어 수식이 먹지 않는다.
const c = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`
const ink = (alpha) => `rgb(var(--ink-rgb) / ${alpha})`

module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // 바탕 — 단색. surface 는 바탕 위 불투명 면(목록 · 입력 · 펼침 메뉴)
        bg: {
          base: c('bg'),
        },
        surface: {
          0: c('surface-0'),
          1: c('surface-1'),
          2: c('surface-2'),
          3: c('surface-3'),
        },

        // 글자 — ink-1 · ink-2 · ink-3 · ink-4
        ink: {
          1: c('ink'),
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        text: {
          primary: c('ink'),
          secondary: 'var(--ink-2)',
          tertiary: 'var(--ink-3)',
          disabled: 'var(--ink-4)',
        },

        // 금 — 금테 · 포커스 · 선택 표시. 예전 accent(에메랄드) 자리를 금이 받는다
        gold: {
          hi: c('gold-hi'),
          DEFAULT: c('gold'),
          lo: c('gold-lo'),
        },
        accent: {
          300: '#f3dc9a',
          400: '#ebcd7c',
          500: c('gold'),
          600: '#c49a43',
          700: '#a57e2f',
          800: c('gold-lo'),
          900: '#5e4416',
          DEFAULT: c('gold'),
          foreground: c('bg'),
        },

        // 색상 유리 — 버튼 면에만
        lapis: c('lapis'),
        olive: c('olive'),
        porphyra: c('porphyra'),

        // 가격 — 한국 관례. 매수 = 상승 빨강, 매도 = 하락 파랑
        up: c('up'),
        down: c('down'),
        buy: {
          DEFAULT: c('up'),
          hover: '#ff7478',
          subtle: 'rgb(var(--up-rgb) / 0.12)',
        },
        sell: {
          DEFAULT: c('down'),
          hover: '#79aeff',
          subtle: 'rgb(var(--down-rgb) / 0.12)',
        },

        // 상태 — 정상 · 오류 · 주의
        ok: c('ok'),
        danger: {
          DEFAULT: c('danger'),
          subtle: 'rgb(var(--danger-rgb) / 0.12)',
        },
        warning: {
          DEFAULT: c('caution'),
          subtle: 'rgb(var(--caution-rgb) / 0.12)',
        },
        info: {
          DEFAULT: '#c9c8c5',
          subtle: 'rgba(201,200,197,0.12)',
        },
        neutral: {
          DEFAULT: '#9e9e9d',
          subtle: 'rgba(158,158,157,0.12)',
        },

        border: {
          DEFAULT: ink(0.14),
          subtle: ink(0.08),
          strong: ink(0.14),
          focus: c('gold-hi'),
        },

        // 옅은 면 · 옅은 테두리 · 표 머리
        wash: c('wash'),
        edge: c('edge'),
        'table-head': c('table-head'),

        connected: c('ok'),
        connecting: c('caution'),
        reconnecting: c('caution'),
        disconnected: c('danger'),
      },
      fontFamily: {
        sans: ['Pretendard Variable', '-apple-system', 'BlinkMacSystemFont', 'Apple SD Gothic Neo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['0.6875rem', { lineHeight: '1rem' }],
        sm: ['0.75rem', { lineHeight: '1.125rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.375rem', { lineHeight: '2rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.25rem' }],
        '3xl': ['2.25rem', { lineHeight: '2.75rem' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        field: '16px',
        panel: '28px',
        sheet: '30px',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        dialog: 'var(--shadow-dialog)',
        side: 'var(--shadow-side)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.3, 1.35, 0.5, 1)',
      },
      animation: {
        'slide-in-top': 'slideInTop 380ms cubic-bezier(0.3, 1.35, 0.5, 1)',
        'fade-in': 'fadeIn 150ms ease',
        'border-pulse': 'borderPulse 500ms ease infinite',
      },
      keyframes: {
        slideInTop: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        borderPulse: {
          '0%, 100%': { borderColor: 'rgb(var(--danger-rgb) / 0.4)' },
          '50%': { borderColor: 'rgb(var(--danger-rgb) / 1)' },
        },
      },
    },
  },
  plugins: [],
}
