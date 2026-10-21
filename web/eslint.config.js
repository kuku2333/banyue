import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  Event: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  AudioContext: 'readonly',
  Audio: 'readonly',
  Image: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  indexedDB: 'readonly',
  crypto: 'readonly',
  performance: 'readonly',
  matchMedia: 'readonly',
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', '*.config.*', 'vite.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/no-v-html': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
