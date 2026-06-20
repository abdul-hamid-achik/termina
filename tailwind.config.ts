import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

export default {
  content: [
    './app/**/*.{vue,ts,js}',
    './components/**/*.{vue,ts,js}',
    './layouts/**/*.{vue,ts,js}',
    './pages/**/*.{vue,ts,js}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          deep: 'rgb(var(--bg-deep) / <alpha-value>)',
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          panel: 'rgb(var(--bg-panel) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          overlay: 'rgb(var(--bg-overlay) / <alpha-value>)',
          // tertiary = elevated (alias so components can use bg-bg-tertiary
          // without a separate token). The TalentPicker hover uses this.
          tertiary: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-color) / <alpha-value>)',
          glow: 'rgb(var(--border-glow) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          dim: 'rgb(var(--text-dim) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        radiant: {
          DEFAULT: 'rgb(var(--color-radiant) / <alpha-value>)',
          deep: 'rgb(var(--color-radiant-deep) / <alpha-value>)',
        },
        dire: {
          DEFAULT: 'rgb(var(--color-dire) / <alpha-value>)',
          deep: 'rgb(var(--color-dire-deep) / <alpha-value>)',
        },
        self: 'rgb(var(--color-self) / <alpha-value>)',
        gold: 'rgb(var(--color-gold) / <alpha-value>)',
        mana: 'rgb(var(--color-mana) / <alpha-value>)',
        damage: 'rgb(var(--color-damage) / <alpha-value>)',
        healing: 'rgb(var(--color-healing) / <alpha-value>)',
        system: 'rgb(var(--color-system) / <alpha-value>)',
        zone: 'rgb(var(--color-zone) / <alpha-value>)',
        // River = the zone color (the river crossing is a neutral zone). Used
        // by AsciiMap's river divider between the radiant/dire halves.
        river: 'rgb(var(--color-zone) / <alpha-value>)',
        ability: 'rgb(var(--color-ability) / <alpha-value>)',
        warn: 'rgb(var(--color-warn) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        'glow-border':
          '0 0 6px rgb(var(--border-glow) / 0.6), inset 0 0 6px rgb(var(--border-glow) / 0.25)',
        'glow-radiant':
          '0 0 12px rgb(var(--color-radiant) / 0.55), 0 0 28px rgb(var(--color-radiant) / 0.25)',
        'glow-dire':
          '0 0 12px rgb(var(--color-dire) / 0.55), 0 0 28px rgb(var(--color-dire) / 0.25)',
        'glow-dire-soft': '0 0 6px rgb(var(--color-dire) / 0.25)',
        'glow-ability':
          '0 0 12px rgb(var(--color-ability) / 0.55), 0 0 28px rgb(var(--color-ability) / 0.25)',
        'glow-ability-soft': '0 0 8px rgb(var(--color-ability) / 0.3)',
        'glow-gold':
          '0 0 12px rgb(var(--color-gold) / 0.55), 0 0 28px rgb(var(--color-gold) / 0.25)',
        'glow-highlight': '0 0 8px rgb(var(--border-glow) / 0.5)',
        'glow-radiant-lg':
          '0 0 18px rgb(var(--color-radiant) / 0.65), 0 0 44px rgb(var(--color-radiant) / 0.35)',
        'glow-dire-lg':
          '0 0 18px rgb(var(--color-dire) / 0.65), 0 0 44px rgb(var(--color-dire) / 0.35)',
        'glow-ability-lg':
          '0 0 18px rgb(var(--color-ability) / 0.65), 0 0 44px rgb(var(--color-ability) / 0.35)',
        'inset-ability': 'inset 3px 0 0 rgb(var(--color-ability))',
      },
      keyframes: {
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        shake: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-3px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(3px, 0, 0)' },
        },
        pop: {
          '0%, 100%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'glow-pulse': {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.35)' },
        },
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        scanline: 'scanline 8s linear infinite',
        shake: 'shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        pop: 'pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fade-in-up': 'fade-in-up 0.25s ease-out',
        'glow-pulse': 'glow-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        '.text-glow': {
          'text-shadow': '0 0 8px currentColor',
        },
      })
    }),
  ],
} satisfies Config
