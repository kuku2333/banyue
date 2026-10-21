import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export type FontScale = 'sm' | 'md' | 'lg'
export type LineHeight = 'normal' | 'loose'

export const useSettingsStore = defineStore('settings', () => {
  const fontScale = useStorage<FontScale>('banyue:font-scale', 'md')
  const lineHeight = useStorage<LineHeight>('banyue:line-height', 'normal')

  function cycleFontScale(): void {
    const order: FontScale[] = ['sm', 'md', 'lg']
    fontScale.value = order[(order.indexOf(fontScale.value) + 1) % order.length]!
  }

  function toggleLineHeight(): void {
    lineHeight.value = lineHeight.value === 'normal' ? 'loose' : 'normal'
  }

  return { fontScale, lineHeight, cycleFontScale, toggleLineHeight }
})
