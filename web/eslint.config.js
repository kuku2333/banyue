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
  HTMLTextAreaElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  DragEvent: 'readonly',
  PointerEvent: 'readonly',
  WheelEvent: 'readonly',
  Event: 'readonly',
  File: 'readonly',
  FileList: 'readonly',
  DataTransfer: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  AudioContext: 'readonly',
  Audio: 'readonly',
  Image: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
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
        URLSearchParams: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    // B 站榜单是外部数据快照，标题里可能带不换行空格等特殊空白
    files: ['src/lib/bili.ts'],
    rules: { 'no-irregular-whitespace': 'off' },
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
