/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // "On-air console" palette for the agent dashboard.
        //
        // Namespaced under `air-*` so it cannot collide with `primary` above or
        // Tailwind's built-in `cyan`/`amber`, which the light pages still use.
        // Must stay inside this same `colors` object — a second `colors` key
        // would silently replace `primary` and break every light-themed page.
        //
        // Each token resolves to a CSS variable holding *space-separated RGB
        // channels* (e.g. `8 11 20`), wrapped here as `rgb(var(--x) / <alpha>)`.
        // Two reasons for the channel form rather than a plain hex variable:
        //   1. Tailwind opacity modifiers keep working — `bg-air-panel/60`.
        //   2. Both themes are a variable swap, so every `text-air-muted` in the
        //      tree re-themes with no per-component edit.
        // Values live in globals.css under .air-scope (dark) and
        // .air-scope[data-theme='light'] (brown + white).
        air: {
          bg: 'rgb(var(--air-bg) / <alpha-value>)',
          bg2: 'rgb(var(--air-bg2) / <alpha-value>)',
          panel: 'rgb(var(--air-panel) / <alpha-value>)',
          line: 'rgb(var(--air-line) / <alpha-value>)',
          line2: 'rgb(var(--air-line2) / <alpha-value>)',
          signal: 'rgb(var(--air-signal) / <alpha-value>)',
          'signal-bright': 'rgb(var(--air-signal-bright) / <alpha-value>)',
          cyan: 'rgb(var(--air-cyan) / <alpha-value>)',
          live: 'rgb(var(--air-live) / <alpha-value>)',
          amber: 'rgb(var(--air-amber) / <alpha-value>)',
          mint: 'rgb(var(--air-mint) / <alpha-value>)',
          text: 'rgb(var(--air-text) / <alpha-value>)',
          muted: 'rgb(var(--air-muted) / <alpha-value>)',
          faint: 'rgb(var(--air-faint) / <alpha-value>)',
        },
        bean: {
          bg: 'rgb(var(--bean-bg) / <alpha-value>)',
          bg2: 'rgb(var(--bean-bg-2) / <alpha-value>)',
          card: 'rgb(var(--bean-card) / <alpha-value>)',
          card2: 'rgb(var(--bean-card-2) / <alpha-value>)',
          line: 'rgb(var(--bean-line) / <alpha-value>)',
          line2: 'rgb(var(--bean-line-2) / <alpha-value>)',
          ink: 'rgb(var(--bean-ink) / <alpha-value>)',
          muted: 'rgb(var(--bean-muted) / <alpha-value>)',
          faint: 'rgb(var(--bean-faint) / <alpha-value>)',
          brand: 'rgb(var(--bean-brand) / <alpha-value>)',
          'brand-bright': 'rgb(var(--bean-brand-bright) / <alpha-value>)',
          'brand-deep': 'rgb(var(--bean-brand-deep) / <alpha-value>)',
          gold: 'rgb(var(--bean-gold) / <alpha-value>)',
          live: 'rgb(var(--bean-live) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Bound to the next/font variables declared in app/layout.tsx. Fonts are
        // self-hosted at build time — a Google Fonts <link> would be blocked by
        // the app CSP (font-src 'self').
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        'mono-ui': ['var(--font-mono-ui)', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'wave': 'wave 1.5s ease-in-out infinite',
        // Dashboard-only. Prefixed so the existing `wave` keyframe in
        // globals.css (used by .audio-wave on the call screen) is untouched.
        'air-blink': 'air-blink 1.6s ease-in-out infinite',
        'air-ripple': 'air-ripple 1.8s ease-out infinite',
        'air-bar': 'air-bar 1.15s ease-in-out infinite',
        'bean-blink': 'bean-blink 1.1s ease-in-out infinite',
      },
      keyframes: {
        'air-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.2' },
        },
        'air-ripple': {
          '0%': { transform: 'scale(1)', opacity: '.8' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        'air-bar': {
          '0%, 100%': { transform: 'scaleY(.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'bean-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.2' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
