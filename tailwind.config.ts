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
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          panel: 'rgb(var(--bg-panel) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-color) / <alpha-value>)',
          glow: 'rgb(var(--border-glow) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          dim: 'rgb(var(--text-dim) / <alpha-value>)',
        },
        radiant: 'rgb(var(--color-radiant) / <alpha-value>)',
        dire: 'rgb(var(--color-dire) / <alpha-value>)',
        self: 'rgb(var(--color-self) / <alpha-value>)',
        gold: 'rgb(var(--color-gold) / <alpha-value>)',
        mana: 'rgb(var(--color-mana) / <alpha-value>)',
        damage: 'rgb(var(--color-damage) / <alpha-value>)',
        healing: 'rgb(var(--color-healing) / <alpha-value>)',
        system: 'rgb(var(--color-system) / <alpha-value>)',
        zone: 'rgb(var(--color-zone) / <alpha-value>)',
        ability: 'rgb(var(--color-ability) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        'glow-border':
          '0 0 4px rgb(var(--border-glow)), inset 0 0 4px rgb(var(--border-glow) / 0.3)',
        'glow-radiant': '0 0 8px rgba(46, 204, 113, 0.2)',
        'glow-dire': '0 0 8px rgba(233, 69, 96, 0.2)',
        'glow-ability': '0 0 8px rgba(0, 212, 255, 0.2)',
        'glow-highlight': '0 0 6px rgba(42, 42, 78, 0.4)',
        'glow-radiant-lg': '0 0 16px rgba(46, 204, 113, 0.3)',
        'glow-dire-lg': '0 0 16px rgba(233, 69, 96, 0.3)',
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
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        scanline: 'scanline 8s linear infinite',
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
