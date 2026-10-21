import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export type ReaderTheme = 'ink' | 'paper' | 'green' | 'night'
export type ReaderMode = 'scroll' | 'paged'
export type ReaderLayout = 'single' | 'spread'

export const READER_THEMES: { id: ReaderTheme; name: string; hint: string }[] = [
  { id: 'ink', name: '墨', hint: '深色 · 低对比' },
  { id: 'paper', name: '纸', hint: '米白 · 护眼' },
  { id: 'green', name: '护', hint: '豆绿 · 久读' },
  { id: 'night', name: '夜', hint: '纯黑 · 睡前' },
]

export const useReaderStore = defineStore('reader', () => {
  const theme = useStorage<ReaderTheme>('banyue:reader:theme', 'ink')
  const mode = useStorage<ReaderMode>('banyue:reader:mode', 'paged')
  const layout = useStorage<ReaderLayout>('banyue:reader:layout', 'spread')
  const fontSize = useStorage<number>('banyue:reader:font-size', 19)
  const lineHeight = useStorage<number>('banyue:reader:line-height', 1.9)
  const columnWidth = useStorage<number>('banyue:reader:width', 38)

  function setTheme(value: ReaderTheme): void {
    theme.value = value
  }

  function bumpFont(delta: number): void {
    fontSize.value = Math.min(26, Math.max(15, fontSize.value + delta))
  }

  function bumpLineHeight(delta: number): void {
    lineHeight.value = Math.min(2.4, Math.max(1.5, Number((lineHeight.value + delta).toFixed(1))))
  }

  function bumpWidth(delta: number): void {
    columnWidth.value = Math.min(52, Math.max(26, columnWidth.value + delta))
  }

  return {
    theme,
    mode,
    layout,
    fontSize,
    lineHeight,
    columnWidth,
    setTheme,
    bumpFont,
    bumpLineHeight,
    bumpWidth,
  }
})
