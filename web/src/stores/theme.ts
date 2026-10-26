// 主题：暗色 / 亮色 / 跟随系统。
// 通过 <html data-theme> 切换，CSS 里用 [data-theme='light'] 覆盖变量，
// 组件不需要感知主题，改一处即可全局生效。
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export type ThemeMode = 'dark' | 'light' | 'auto'

export const THEME_MODES: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'dark', label: '暗色', icon: '◐' },
  { id: 'light', label: '亮色', icon: '☀' },
  { id: 'auto', label: '跟随系统', icon: '◑' },
]

const STORAGE_KEY = 'banyue:theme'

/** 系统是否偏好亮色 */
function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export const useThemeStore = defineStore('theme', () => {
  const mode = useStorage<ThemeMode>(STORAGE_KEY, 'dark')
  /** 系统偏好，auto 模式下决定实际主题 */
  const systemLight = ref(systemPrefersLight())

  /** 实际生效的主题（把 auto 解析成 dark/light） */
  const resolved = computed<'dark' | 'light'>(() => {
    if (mode.value === 'auto') return systemLight.value ? 'light' : 'dark'
    return mode.value
  })

  function apply(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = resolved.value
    // 移动端地址栏配色也跟着走
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', resolved.value === 'light' ? '#f6f8fb' : '#0a0e13')
  }

  function cycle(): void {
    const order = THEME_MODES.map((item) => item.id)
    mode.value = order[(order.indexOf(mode.value) + 1) % order.length]!
  }

  function set(next: ThemeMode): void {
    mode.value = next
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

  watch([mode, resolved], apply, { immediate: true })

  return { mode, resolved, cycle, set, apply, watchSystem }
})
