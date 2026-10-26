// 主题：明暗模式（暗 / 亮 / 跟随系统）× 配色风格（青绿 / 暖纸 / 夜空 / 森绿 / 樱粉）。
// 两个维度独立：模式决定底子亮度，风格决定主色与背景色相。
// <html data-theme="dark|light" data-palette="teal|paper|night|forest|sakura">
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

/** 明暗模式 */
export type ThemeMode = 'dark' | 'light' | 'auto'
/** 配色风格 */
export type PaletteId = 'teal' | 'paper' | 'night' | 'forest' | 'sakura'

export const THEME_MODES: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'dark', label: '暗色', icon: '◐' },
  { id: 'light', label: '亮色', icon: '☀' },
  { id: 'auto', label: '跟随系统', icon: '◑' },
]

export const PALETTES: { id: PaletteId; label: string; swatch: string; hint: string }[] = [
  { id: 'teal', label: '青绿', swatch: '#5eead4', hint: '默认，冷色清爽' },
  { id: 'paper', label: '暖纸', swatch: '#c9a227', hint: '米黄底，长时间阅读不刺眼' },
  { id: 'night', label: '夜空', swatch: '#818cf8', hint: '靛蓝紫，偏静谧' },
  { id: 'forest', label: '森绿', swatch: '#4ade80', hint: '草绿，自然色' },
  { id: 'sakura', label: '樱粉', swatch: '#f472b6', hint: '淡粉，柔和' },
]

const STORAGE_KEY = 'banyue:theme'
const PALETTE_KEY = 'banyue:palette'

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export const useThemeStore = defineStore('theme', () => {
  const mode = useStorage<ThemeMode>(STORAGE_KEY, 'dark')
  const palette = useStorage<PaletteId>(PALETTE_KEY, 'teal')
  /** 系统偏好，auto 模式下决定实际主题 */
  const systemLight = ref(systemPrefersLight())

  /** 实际生效的明暗（把 auto 解析成 dark/light） */
  const resolved = computed<'dark' | 'light'>(() => {
    if (mode.value === 'auto') return systemLight.value ? 'light' : 'dark'
    return mode.value
  })

  const modeInfo = computed(() => THEME_MODES.find((item) => item.id === mode.value) ?? THEME_MODES[0]!)

  function apply(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = resolved.value
    root.dataset.palette = palette.value
    // 移动端地址栏配色跟着走：取当前配色的背景色
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
      if (bg) meta.setAttribute('content', bg)
    }
  }

  /** 点按钮：明暗三档循环 */
  function cycle(): void {
    const order: ThemeMode[] = ['dark', 'light', 'auto']
    mode.value = order[(order.indexOf(mode.value) + 1) % order.length]!
  }

  function set(next: ThemeMode): void {
    mode.value = next
  }

  function setPalette(next: PaletteId): void {
    palette.value = next
  }

  /** 监听系统主题变化（只在 auto 模式下影响实际显示） */
  function watchSystem(): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (event: MediaQueryListEvent): void => {
      systemLight.value = event.matches
    }
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }

  watch([mode, resolved, palette], apply, { immediate: true })

  return { mode, palette, resolved, modeInfo, cycle, set, setPalette, apply, watchSystem }
})
