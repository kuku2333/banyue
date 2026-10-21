import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Track } from '@/lib/music'
import { resolvePreview } from '@/lib/music'

export const usePlayerStore = defineStore('player', () => {
  const queue = ref<Track[]>([])
  const index = ref(-1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const collapsed = ref(false)
  const error = ref('')
  const loading = ref(false)
  const favorites = useStorage<Track[]>('banyue:favorites', [])

  let audio: HTMLAudioElement | null = null
  let objectUrl: string | null = null

  const current = computed<Track | null>(() => queue.value[index.value] ?? null)
  const progress = computed(() => (duration.value > 0 ? currentTime.value / duration.value : 0))
  const hasNext = computed(() => index.value < queue.value.length - 1)
  const hasPrev = computed(() => index.value > 0)

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio
    const element = new Audio()
    element.preload = 'metadata'
    element.addEventListener('timeupdate', () => {
      currentTime.value = element.currentTime
    })
    element.addEventListener('loadedmetadata', () => {
      duration.value = Number.isFinite(element.duration) ? element.duration : 0
    })
    element.addEventListener('play', () => {
      playing.value = true
    })
    element.addEventListener('pause', () => {
      playing.value = false
    })
    element.addEventListener('ended', () => {
      void next()
    })
    element.addEventListener('error', () => {
      playing.value = false
      error.value = '这首暂时播不了，换一首试试'
      setTimeout(() => (error.value = ''), 3000)
    })
    audio = element
    return element
  }

  async function resolveSource(track: Track): Promise<string | null> {
    if (track.local) {
      // 动态引入：Dexie 只在真的播放本地文件时才加载，避免进主包
      const { getTrackBlob } = await import('@/lib/db')
      const blob = await getTrackBlob(track.id)
      if (!blob) return null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(blob)
      return objectUrl
    }
    return resolvePreview(track)
  }

  async function load(target: Track, autoplay = true): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const src = await resolveSource(target)
      if (!src) {
        error.value = '没有找到可播放的音源'
        return
      }
      const element = ensureAudio()
      element.src = src
      currentTime.value = 0
      duration.value = 0
      if (autoplay) await element.play()
    } catch {
      error.value = '播放失败，可能是网络或格式问题'
      playing.value = false
    } finally {
      loading.value = false
    }
  }

  async function playList(tracks: Track[], start = 0): Promise<void> {
    if (!tracks.length) return
    queue.value = [...tracks]
    index.value = Math.min(Math.max(start, 0), tracks.length - 1)
    collapsed.value = false
    await load(queue.value[index.value]!)
  }

  async function playOne(track: Track): Promise<void> {
    await playList([track])
  }

  async function toggle(): Promise<void> {
    const element = ensureAudio()
    if (!current.value) return
    if (!element.src) {
      await load(current.value)
      return
    }
    if (element.paused) await element.play()
    else element.pause()
  }

  async function next(): Promise<void> {
    if (index.value >= queue.value.length - 1) {
      ensureAudio().pause()
      return
    }
    index.value++
    await load(queue.value[index.value]!)
  }

  async function prev(): Promise<void> {
    const element = ensureAudio()
    if (element.currentTime > 3) {
      element.currentTime = 0
      return
    }
    if (index.value <= 0) {
      element.currentTime = 0
      return
    }
    index.value--
    await load(queue.value[index.value]!)
  }

  function seek(ratio: number): void {
    const element = ensureAudio()
    if (!duration.value) return
    element.currentTime = Math.min(Math.max(ratio, 0), 1) * duration.value
  }

  function close(): void {
    const element = ensureAudio()
    element.pause()
    element.removeAttribute('src')
    element.load()
    queue.value = []
    index.value = -1
    currentTime.value = 0
    duration.value = 0
  }

  function isFavorite(id: string): boolean {
    return favorites.value.some((track) => track.id === id)
  }

  function toggleFavorite(track: Track): void {
    if (isFavorite(track.id)) {
      favorites.value = favorites.value.filter((item) => item.id !== track.id)
    } else {
      favorites.value = [...favorites.value, track]
    }
  }

  return {
    queue,
    index,
    playing,
    currentTime,
    duration,
    collapsed,
    error,
    loading,
    favorites,
    current,
    progress,
    hasNext,
    hasPrev,
    playList,
    playOne,
    toggle,
    next,
    prev,
    seek,
    close,
    isFavorite,
    toggleFavorite,
  }
})
