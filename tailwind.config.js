/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        bg: '#f7f8fc',
        surface: { DEFAULT: '#ffffff', 2: '#f1f3f9', 3: '#e8eaf2' },
        border: { DEFAULT: '#e2e5f0', 2: '#ced2e8' },
        accent: { DEFAULT: '#5b5ef4', soft: '#eeeeff', hover: '#4a4de0' },
        ink: { DEFAULT: '#1a1d2e', 2: '#5a6080', 3: '#9ba3c0' },
        sidebar: '#16183a',
        success: '#16a34a',
        warning: '#d97706',
        danger: '#e03e3e',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(30,35,80,0.06)',
        md: '0 4px 16px rgba(30,35,80,0.08)',
        lg: '0 12px 40px rgba(30,35,80,0.12)',
      },
    },
  },
  plugins: [],
}
